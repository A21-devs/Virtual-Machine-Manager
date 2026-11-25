import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { constants, setPriority, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { VmConfig } from '@shared/config'
import { buildQemuArgs } from '@shared/qemuArgs'
import type { VmRuntimeState, VmStatus } from '@shared/ipc'
import { QmpClient } from './qmp'
import { QemuImg } from './qemuImg'
import { detectAccel, qemuImgFor, qemuShareFor, type DataPaths } from './paths'

interface Running {
  proc: ChildProcess
  qmp: QmpClient | null
  qmpError: string | null
  status: VmStatus
  startedAt: number
  accel: 'whpx' | 'tcg'
  agentPort: number
  /** set when we asked QEMU to go away on purpose (save state), so it isn't reported as a crash */
  expectedExit: boolean
}

/** Internal snapshot name used for the one-click save state. Profiles use other names. */
export const QUICKSAVE = 'vmm-quicksave'

const NO_QEMU = "QEMU was not found. Install it or put it in the data folder's qemu\\ directory."

/** HMP commands report failure as text in a successful reply. */
function hmpCheck(out: string): string {
  if (/^\s*Error/im.test(out)) throw new Error(out.trim().replace(/^Error:\s*/i, ''))
  return out
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      srv.close(() => (typeof addr === 'object' && addr ? resolve(addr.port) : reject(new Error('no port'))))
    })
  })
}

export class VmRunner extends EventEmitter {
  private running = new Map<string, Running>()

  constructor(
    private readonly paths: DataPaths,
    private readonly qemu: () => string | null
  ) {
    super()
  }

  img(): QemuImg {
    const q = this.qemu()
    if (!q) throw new Error(NO_QEMU)
    return new QemuImg(qemuImgFor(q))
  }

  state(name: string): VmRuntimeState {
    const r = this.running.get(name)
    return r ? { name, status: r.status, pid: r.proc.pid ?? null, startedAt: r.startedAt } : { name, status: 'off', pid: null, startedAt: null }
  }

  allStates(): VmRuntimeState[] {
    return [...this.running.keys()].map((n) => this.state(n))
  }

  qmpFor(name: string): QmpClient | null {
    return this.running.get(name)?.qmp ?? null
  }

  /** QEMU's process id for every VM that is running, for the usage sampler */
  pids(): Map<string, number> {
    const m = new Map<string, number>()
    for (const [n, r] of this.running) if (r.proc.pid) m.set(n, r.proc.pid)
    return m
  }

  isRunning(name: string): boolean {
    return this.running.has(name)
  }

  accelOf(name: string): 'whpx' | 'tcg' | null {
    return this.running.get(name)?.accel ?? null
  }

  private setStatus(name: string, status: VmStatus): void {
    const r = this.running.get(name)
    if (r) r.status = status
    this.emit('state', status === 'off' ? { name, status: 'off', pid: null, startedAt: null } : this.state(name))
  }

  async start(cfg: VmConfig, opts: { loadState?: string } = {}): Promise<void> {
    if (this.running.has(cfg.name)) throw new Error(`${cfg.name} is already running`)
    const qemu = this.qemu()
    if (!qemu) throw new Error(NO_QEMU)

    if (!existsSync(cfg.diskPath)) await this.img().create(cfg.diskPath, cfg.diskSizeGB)

    const accel = cfg.accel === 'auto' ? await detectAccel(qemu) : cfg.accel
    const qmpPort = await freePort()
    // freePort releases the port before returning, so the OS can hand it out twice
    let agentPort = await freePort()
    while (agentPort === qmpPort) agentPort = await freePort()
    const args = buildQemuArgs(cfg, {
      accel,
      qemuShareDir: qemuShareFor(qemu),
      qmpPort,
      agentPort,
      loadState: opts.loadState,
      isoExists: Boolean(cfg.iso) && existsSync(cfg.iso)
    })

    const log = createWriteStream(join(this.paths.logs, `${cfg.name}.log`), { flags: 'w' })
    log.write(`> ${qemu} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}\n\n`)

    const proc = spawn(qemu, args, { cwd: dirname(qemu), windowsHide: false })
    proc.stdout?.pipe(log, { end: false })
    proc.stderr?.pipe(log, { end: false })

    const entry: Running = { proc, qmp: null, qmpError: null, status: 'starting', startedAt: Date.now(), accel, agentPort, expectedExit: false }
    this.running.set(cfg.name, entry)
    this.setStatus(cfg.name, 'starting')

    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))

    proc.once('exit', (code) => {
      entry.qmp?.close()
      this.running.delete(cfg.name)
      log.end()
      this.setStatus(cfg.name, 'off')
      // died during boot = config problem, tell the UI why
      if (!entry.expectedExit && Date.now() - entry.startedAt < 3000 && code !== 0) {
        this.emit('crash', { name: cfg.name, message: stderr.trim() || `QEMU exited with code ${code}` })
      }
    })

    // give QEMU more CPU time than background apps, this helps a lot with input lag
    if (proc.pid) {
      try {
        setPriority(proc.pid, constants.priority.PRIORITY_ABOVE_NORMAL)
      } catch {
        /* not fatal */
      }
    }

    try {
      const qmp = new QmpClient(qmpPort)
      await qmp.connect()
      entry.qmp = qmp
      qmp.on('event', (ev: string) => {
        if (ev === 'STOP') this.setStatus(cfg.name, 'paused')
        if (ev === 'RESUME') this.setStatus(cfg.name, 'running')
      })
      // -loadvm can leave the VM stopped, so ask QEMU instead of assuming
      const st = await qmp.execute<{ running: boolean }>('query-status').catch(() => ({ running: true }))
      this.setStatus(cfg.name, st.running ? 'running' : 'paused')
    } catch (err) {
      // QEMU may have died already, the exit handler reports that.
      // If it's still up we just can't control it, remember why for the power buttons.
      if (this.running.has(cfg.name)) {
        entry.qmpError = err instanceof Error ? err.message : String(err)
        this.setStatus(cfg.name, 'running')
      }
    }
  }

  private need(name: string): QmpClient {
    const r = this.running.get(name)
    if (!r) throw new Error(`${name} is not running`)
    if (!r.qmp) {
      throw new Error(
        `${name} is running but the app couldn't connect to its control socket (${r.qmpError ?? 'still starting'}). Check the Log tab, or use Force off.`
      )
    }
    return r.qmp
  }

  pause = (name: string) => this.need(name).execute('stop')
  resume = (name: string) => this.need(name).execute('cont')
  reset = (name: string) => this.need(name).execute('system_reset')
  /** asks the guest OS to shut down cleanly (like pressing the power button) */
  shutdown = (name: string) => this.need(name).execute('system_powerdown')

  /** pulls the plug */
  kill(name: string): void {
    const r = this.running.get(name)
    if (!r) return
    r.qmp?.execute('quit').catch(() => undefined)
    setTimeout(() => r.proc.exitCode === null && r.proc.kill(), 1500)
  }

  killAll(): void {
    for (const name of this.running.keys()) this.kill(name)
  }

  /** resolves true when the VM's process is gone (right away if it isn't running), false on timeout */
  waitForExit(name: string, timeoutMs: number): Promise<boolean> {
    const r = this.running.get(name)
    if (!r) return Promise.resolve(true)
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), timeoutMs)
      r.proc.once('exit', () => {
        clearTimeout(t)
        resolve(true)
      })
    })
  }

  /** PNG of the current screen. QEMU writes the file itself, so the path has to be absolute. */
  async screendump(name: string, file: string): Promise<void> {
    await this.need(name).execute('screendump', { filename: file, format: 'png' })
  }

  private shotNo = 0

  /**
   * The current screen as PNG bytes, for the live preview. null when the VM is off,
   * QMP isn't connected yet or the VM stops halfway, the preview just tries again later.
   */
  async screenPng(name: string): Promise<Buffer | null> {
    if (!this.isRunning(name)) return null
    // unique per call, so two VMs (or two quick calls) never write the same file
    const file = join(tmpdir(), `vmm-preview-${process.pid}-${++this.shotNo}.png`)
    try {
      await this.screendump(name, file)
      return await readFile(file)
    } catch {
      return null
    } finally {
      await rm(file, { force: true })
    }
  }

  /**
   * Saves RAM + disk into the qcow2 as QUICKSAVE and quits. Only works without WHPX:
   * QEMU's WHPX backend blocks migration ("missing dirty memory tracking support"),
   * and savevm is built on migration.
   */
  async saveAndQuit(name: string): Promise<void> {
    const r = this.running.get(name)
    if (!r) throw new Error(`${name} is not running`)
    if (r.accel === 'whpx') throw new Error('QEMU cannot save RAM state while using WHPX acceleration.')
    const qmp = this.need(name)
    hmpCheck(await qmp.hmp(`savevm ${QUICKSAVE}`))
    r.expectedExit = true
    await qmp.execute('quit').catch(() => undefined)
    if (!(await this.waitForExit(name, 10_000))) r.proc.kill()
  }

  /** drops an internal snapshot from a running VM's disk (a loaded save state, or a profile) */
  async deleteSnapshotLive(name: string, tag: string): Promise<void> {
    await this.need(name).execute('blockdev-snapshot-delete-internal-sync', { device: 'disk0', name: tag })
  }

  /** whether the VM's disk holds a save state. -U reads it even while QEMU has it open. */
  async hasSaveState(cfg: VmConfig): Promise<boolean> {
    if (!existsSync(cfg.diskPath)) return false
    return (await this.img().info(cfg.diskPath)).snapshots.some((s) => s.name === QUICKSAVE)
  }

  agentPortOf(name: string): number {
    const r = this.running.get(name)
    if (!r) throw new Error(`${name} is not running`)
    return r.agentPort
  }

  /** the guest is about to power itself off (hibernating), don't report that as a crash */
  markExpectedExit(name: string, expected = true): void {
    const r = this.running.get(name)
    if (r) r.expectedExit = expected
  }
}
