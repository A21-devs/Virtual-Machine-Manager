import { chmodSync, existsSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { validateVmName, type PortForward, type VmConfig } from '@shared/config'
import type { DataPaths } from './paths'
import type { ImgSnapshot } from './qemuImg'
import { QUICKSAVE, type VmRunner } from './vmRunner'

const GB = 1024 ** 3

function needOff(runner: VmRunner, cfg: VmConfig, what: string): void {
  if (runner.isRunning(cfg.name)) throw new Error(`Power off ${cfg.name} before you ${what}.`)
}

/** "save state" when the only snapshot is the quick save, "profiles" otherwise */
const snapshotWord = (snaps: ImgSnapshot[]) => (snaps.every((s) => s.name === QUICKSAVE) ? 'save state' : 'profiles')

/** Only growing is allowed. Shrinking a disk under the guest's partitions destroys data. */
export async function resizeDisk(runner: VmRunner, cfg: VmConfig, sizeGB: number): Promise<void> {
  needOff(runner, cfg, 'resize its disk')
  if (!Number.isInteger(sizeGB) || sizeGB < 1 || sizeGB > 16384) throw new Error('Pick a whole number of GB between 1 and 16384')
  if (!existsSync(cfg.diskPath)) return // no disk file yet, the new size is used when it's created
  const img = runner.img()
  const info = await img.info(cfg.diskPath)
  if (sizeGB * GB < info.virtualBytes) throw new Error(`The disk is already ${Math.round(info.virtualBytes / GB)} GB. It can only grow.`)
  if (sizeGB * GB === info.virtualBytes) return
  if (info.snapshots.length > 0) throw new Error(`qemu-img can't resize a disk that has snapshots. Delete this VM's ${snapshotWord(info.snapshots)} first.`)
  await img.resize(cfg.diskPath, sizeGB)
}

/** Rewrites the disk into a fresh file, which gives back the space the guest has freed. */
export async function compactDisk(runner: VmRunner, cfg: VmConfig): Promise<{ before: number; after: number }> {
  needOff(runner, cfg, 'compact its disk')
  if (!existsSync(cfg.diskPath)) throw new Error('This VM has no disk file yet')
  const img = runner.img()
  const info = await img.info(cfg.diskPath)
  // convert doesn't copy internal snapshots, they would be gone afterwards
  if (info.snapshots.length > 0) throw new Error(`Compacting would throw away this VM's ${snapshotWord(info.snapshots)}. Delete them first if you really want to.`)
  if (info.backingFile) throw new Error('This disk is a linked clone. Compacting it would copy the whole base disk into it.')
  const tmp = `${cfg.diskPath}.compact.tmp`
  rmSync(tmp, { force: true })
  try {
    await img.convert(cfg.diskPath, tmp)
    // one rename that replaces the disk. With two (disk -> .old, tmp -> disk) a crash in between
    // leaves no file at diskPath, and the next Power on would create a blank disk there
    renameSync(tmp, cfg.diskPath)
  } catch (e) {
    rmSync(tmp, { force: true }) // the original is untouched
    throw e
  }
  return { before: info.actualBytes, after: (await img.info(cfg.diskPath)).actualBytes }
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
      const what = snapshotWord(info.snapshots)
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
