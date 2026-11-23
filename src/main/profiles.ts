import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VmConfig } from '@shared/config'
import type { Profile } from '@shared/ipc'
import type { DataPaths } from './paths'
import { agentHibernate } from './agent'
import { QUICKSAVE, type VmRunner } from './vmRunner'

interface Meta {
  label: string
  note: string
  created: number
  session?: boolean
}

type MetaFile = Record<string, Meta>

/** how long a guest gets to write its memory to disk and power off */
const HIBERNATE_TIMEOUT_MS = 5 * 60_000

/** Profiles are internal qcow2 snapshots. Labels, notes and screenshots live next to them in profiles/<vm>/. */
export class Profiles {
  constructor(
    private readonly paths: DataPaths,
    private readonly runner: VmRunner
  ) {}

  private dir(vm: string): string {
    return join(this.paths.profiles, vm)
  }

  private shotFile(vm: string, tag: string): string {
    return join(this.dir(vm), `${tag}.png`)
  }

  private readMeta(vm: string): MetaFile {
    try {
      return JSON.parse(readFileSync(join(this.dir(vm), 'profiles.json'), 'utf8')) as MetaFile
    } catch {
      return {}
    }
  }

  private writeMeta(vm: string, meta: MetaFile): void {
    mkdirSync(this.dir(vm), { recursive: true })
    const f = join(this.dir(vm), 'profiles.json')
    writeFileSync(`${f}.tmp`, JSON.stringify(meta, null, 2), 'utf8')
    renameSync(`${f}.tmp`, f)
  }

  async list(cfg: VmConfig): Promise<Profile[]> {
    if (!existsSync(cfg.diskPath)) return []
    const info = await this.runner.img().info(cfg.diskPath)
    const meta = this.readMeta(cfg.name)
    return info.snapshots
      .filter((s) => s.name !== QUICKSAVE)
      .map((s) => ({
        tag: s.name,
        // snapshots made outside the app just show their QEMU name
        label: meta[s.name]?.label ?? s.name,
        note: meta[s.name]?.note ?? '',
        created: meta[s.name]?.created ?? s.dateSec * 1000,
        kind: s.vmStateSize > 0 ? ('full' as const) : meta[s.name]?.session ? ('session' as const) : ('disk' as const),
        hasShot: existsSync(this.shotFile(cfg.name, s.name))
      }))
      .sort((a, b) => b.created - a.created)
  }

  /**
   * Saves the running session as a new profile. QEMU can't save WHPX memory, so the guest
   * hibernates: everything open is written to its own disk and it powers off. Snapshotting
   * that disk captures the whole session, and booting the snapshot later resumes it.
   */
  async take(cfg: VmConfig, label: string, note: string): Promise<Profile> {
    const clean = label.trim()
    if (!clean) throw new Error('Give the profile a name')
    if (clean.length > 80) throw new Error('Profile name is too long (80 max)')
    if (!this.runner.isRunning(cfg.name)) throw new Error('Power the VM on to save a profile of it')
    const tag = `p${Date.now().toString(36)}`

    mkdirSync(this.dir(cfg.name), { recursive: true })
    // a missing screenshot isn't worth failing the save over
    await this.runner.screendump(cfg.name, this.shotFile(cfg.name, tag)).catch(() => undefined)
    try {
      await agentHibernate(this.runner.agentPortOf(cfg.name))
    } catch (e) {
      rmSync(this.shotFile(cfg.name, tag), { force: true })
      throw new Error(`needs-guest-setup: ${e instanceof Error ? e.message : String(e)}`)
    }
    this.runner.markExpectedExit(cfg.name)
    const closed = await this.runner.waitForExit(cfg.name, HIBERNATE_TIMEOUT_MS)
    if (!closed) throw new Error(`${cfg.name} did not finish saving within 5 minutes. Check its window.`)

    await this.runner.img().snapshotCreate(cfg.diskPath, tag)
    const meta = this.readMeta(cfg.name)
    meta[tag] = { label: clean, note: note.trim(), created: Date.now(), session: true }
    this.writeMeta(cfg.name, meta)
    // pick up right where it was, so saving a profile doesn't end the session
    await this.runner.start(cfg)
    return { tag, label: clean, note: note.trim(), created: meta[tag].created, kind: 'session', hasShot: existsSync(this.shotFile(cfg.name, tag)) }
  }

  /** Rolls back to the profile and boots it. A session profile resumes everything that was open. */
  async launch(cfg: VmConfig, tag: string, force: boolean): Promise<void> {
    if (this.runner.isRunning(cfg.name)) {
      if (!force) throw new Error('vm-running')
      this.runner.kill(cfg.name)
      await this.runner.waitForExit(cfg.name, 15_000)
    }
    if ((await this.restore(cfg, tag)) === 'applied') await this.runner.start(cfg)
  }

  /** Rolls the disk back to the profile. Full (RAM) profiles boot straight into the saved state instead. */
  async restore(cfg: VmConfig, tag: string): Promise<'applied' | 'booted'> {
    if (this.runner.isRunning(cfg.name)) {
      throw new Error('Power off the VM first. Rolling back the disk under a running guest would corrupt it.')
    }
    const snap = (await this.runner.img().info(cfg.diskPath)).snapshots.find((s) => s.name === tag)
    if (!snap) throw new Error('That profile no longer exists on the disk')
    if (snap.vmStateSize > 0) {
      await this.runner.start(cfg, { loadState: tag })
      return 'booted'
    }
    await this.runner.img().snapshotApply(cfg.diskPath, tag)
    return 'applied'
  }

  async remove(cfg: VmConfig, tag: string): Promise<void> {
    if (this.runner.isRunning(cfg.name)) await this.runner.deleteSnapshotLive(cfg.name, tag)
    else await this.runner.img().snapshotDelete(cfg.diskPath, tag)
    const meta = this.readMeta(cfg.name)
    delete meta[tag]
    this.writeMeta(cfg.name, meta)
    rmSync(this.shotFile(cfg.name, tag), { force: true })
  }

  edit(cfg: VmConfig, tag: string, label: string, note: string): void {
    const clean = label.trim()
    if (!clean) throw new Error('Give the profile a name')
    const meta = this.readMeta(cfg.name)
    meta[tag] = { ...meta[tag], label: clean, note: note.trim(), created: meta[tag]?.created ?? Date.now() }
    this.writeMeta(cfg.name, meta)
  }

  /** the screenshot as a data: URL, or null if there isn't one */
  shot(vm: string, tag: string): string | null {
    const f = this.shotFile(vm, tag)
    if (!existsSync(f)) return null
    return `data:image/png;base64,${readFileSync(f).toString('base64')}`
  }

  /** keeps labels and screenshots attached when a VM is renamed */
  rename(from: string, to: string): void {
    if (from === to || !existsSync(this.dir(from)) || existsSync(this.dir(to))) return
    renameSync(this.dir(from), this.dir(to))
  }
}
