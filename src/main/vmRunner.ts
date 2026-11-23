import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { constants, setPriority } from 'node:os'
import { dirname, join } from 'node:path'
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import type { VmConfig } from '@shared/config'
import { buildQemuArgs } from '@shared/qemuArgs'
import type { VmRuntimeState, VmStatus } from '@shared/ipc'
import { QmpClient } from './qmp'
import { detectAccel, qemuImgFor, qemuShareFor, type DataPaths } from './paths'

interface Running {
  proc: ChildProcess
  qmp: QmpClient | null
  status: VmStatus
  startedAt: number
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

  private setStatus(name: string, status: VmStatus): void {
    const r = this.running.get(name)
    if (r) r.status = status
    this.emit('state', status === 'off' ? { name, status: 'off', pid: null, startedAt: null } : this.state(name))
  }

  async start(cfg: VmConfig, opts: { loadState?: string } = {}): Promise<void> {
    if (this.running.has(cfg.name)) throw new Error(`${cfg.name} is already running`)
    const qemu = this.qemu()
    if (!qemu) throw new Error('QEMU was not found. Install it or put it in the data folder\'s qemu\\ directory.')

    if (!existsSync(cfg.diskPath)) {
      execFileSync(qemuImgFor(qemu), ['create', '-f', 'qcow2', cfg.diskPath, `${cfg.diskSizeGB}G`], { windowsHide: true })
    }

    const accel = cfg.accel === 'auto' ? await detectAccel(qemu) : cfg.accel
    const qmpPort = await freePort()
    const args = buildQemuArgs(cfg, {
      accel,
      qemuShareDir: qemuShareFor(qemu),
      qmpPort,
      loadState: opts.loadState,
      isoExists: Boolean(cfg.iso) && existsSync(cfg.iso)
    })

    const log = createWriteStream(join(this.paths.logs, `${cfg.name}.log`), { flags: 'w' })
    log.write(`> ${qemu} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}\n\n`)

    const proc = spawn(qemu, args, { cwd: dirname(qemu), windowsHide: false })
    proc.stdout?.pipe(log, { end: false })
    proc.stderr?.pipe(log, { end: false })

    const entry: Running = { proc, qmp: null, status: 'starting', startedAt: Date.now() }
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
      if (Date.now() - entry.startedAt < 3000 && code !== 0) {
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
      this.setStatus(cfg.name, 'running')
    } catch {
      // QEMU may have died already, the exit handler reports that
      if (this.running.has(cfg.name)) this.setStatus(cfg.name, 'running')
    }
  }

  private need(name: string): QmpClient {
    const q = this.running.get(name)?.qmp
    if (!q) throw new Error(`${name} is not running`)
    return q
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
}
