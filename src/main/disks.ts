import { chmodSync, existsSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { validateVmName, type PortForward, type VmConfig } from '@shared/config'
import type { DataPaths } from './paths'
import { QUICKSAVE, type VmRunner } from './vmRunner'

function needOff(runner: VmRunner, cfg: VmConfig, what: string): void {
  if (runner.isRunning(cfg.name)) throw new Error(`Power off ${cfg.name} before you ${what}.`)
}

/**
 * The clone gets the same forwards on the next host ports no other VM uses, so both can
 * run at once. Two VMs on one host port means whichever starts second fails.
 */
export function shiftForwards(forwards: PortForward[], others: VmConfig[]): PortForward[] {
  const used = new Set(others.flatMap((c) => c.forwards.map((f) => `${f.proto}:${f.hostPort}`)))
  return forwards.map((f) => {
    let port = f.hostPort
    while (used.has(`${f.proto}:${port}`) && port < 65535) port++
    used.add(`${f.proto}:${port}`)
    return { ...f, hostPort: port }
  })
}

/**
 * Full clone: an independent copy of the disk.
 * Linked clone: both VMs become thin overlays on a shared read-only base, so the copy
 * takes seconds and almost no space. The source's current disk turns into that base.
 * `library` is every VM, the source included.
 */
export async function cloneVm(
  runner: VmRunner,
  paths: DataPaths,
  cfg: VmConfig,
  newName: string,
  linked: boolean,
  library: VmConfig[]
): Promise<VmConfig> {
  const name = newName.trim()
  const err = validateVmName(name)
  if (err) throw new Error(err)
  // config files are per name and Windows file names ignore case
  if (library.some((o) => o.name.toLowerCase() === name.toLowerCase())) throw new Error(`A VM called "${name}" already exists`)
  needOff(runner, cfg, 'clone it')
  if (!existsSync(cfg.diskPath)) throw new Error('This VM has no disk yet, there is nothing to clone')
  const target = join(paths.disks, `${name}.qcow2`)
  if (existsSync(target)) throw new Error(`${target} already exists`)

  const img = runner.img()
  if (!linked) {
    // convert doesn't copy internal snapshots, so the copy starts without the source's profiles
    try {
      await img.convert(cfg.diskPath, target)
    } catch (e) {
      rmSync(target, { force: true }) // don't leave a half-written disk that blocks the next try
      throw e
    }
  } else {
    const info = await img.info(cfg.diskPath)
    if (info.snapshots.length > 0) {
      const what = info.snapshots.every((s) => s.name === QUICKSAVE) ? 'save state' : 'profiles'
      throw new Error(`A linked clone freezes the current disk as a shared base, and this VM's ${what} would be stuck inside it. Delete them first, or make a full clone.`)
    }
    const base = cfg.diskPath.replace(/\.qcow2$/i, '') + `.base-${Date.now().toString(36)}.qcow2`
    renameSync(cfg.diskPath, base)
    try {
      await img.createOverlay(cfg.diskPath, base)
      await img.createOverlay(target, base)
    } catch (e) {
      rmSync(target, { force: true })
      rmSync(cfg.diskPath, { force: true })
      renameSync(base, cfg.diskPath) // put the original back
      throw e
    }
    // the base must never change again or both overlays break
    chmodSync(base, 0o444)
  }
  return { ...cfg, name, diskPath: target, forwards: shiftForwards(cfg.forwards, library), autostart: false, resumeLast: false }
}
