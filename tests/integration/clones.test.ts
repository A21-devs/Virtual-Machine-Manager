// Makes linked and full clones with real qemu-img and boots them, all in a temp folder.
// Run with: npm run test:qemu
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { defaultConfig, type VmConfig } from '@shared/config'
import type { VmRuntimeState } from '@shared/ipc'
import { cloneVm } from '../../src/main/disks'
import { dataPaths, findQemu } from '../../src/main/paths'
import { VmRunner } from '../../src/main/vmRunner'

const root = mkdtempSync(join(tmpdir(), 'vmm-clone-'))
const paths = dataPaths(root)
const qemu = findQemu(paths) ?? findQemu(dataPaths())

const waitFor = (runner: VmRunner, name: string, status: VmRuntimeState['status'], ms = 20000) =>
  new Promise<void>((resolve, reject) => {
    if (runner.state(name).status === status) return resolve()
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${status}`)), ms)
    const on = (s: VmRuntimeState) => {
      if (s.name === name && s.status === status) {
        clearTimeout(t)
        runner.off('state', on)
        resolve()
      }
    }
    runner.on('state', on)
  })

const vm = (name: string, extra: Partial<VmConfig> = {}): VmConfig => ({
  ...defaultConfig(name, paths.disks),
  cpus: 1,
  ramMB: 256,
  diskSizeGB: 1,
  display: 'none',
  usbTablet: false,
  network: 'none',
  ...extra
})

describe.skipIf(!qemu)('clones with real qemu-img', () => {
  const runner = new VmRunner(paths, () => qemu)

  afterAll(async () => {
    runner.killAll()
    await new Promise((r) => setTimeout(r, 2500))
    rmSync(root, { recursive: true, force: true })
  })

  it('makes linked and full clones that both boot', async () => {
    const src = vm('clone src')
    await runner.img().create(src.diskPath, 1)
    const linked = await cloneVm(runner, paths, src, 'clone linked', true, [src])
    const srcInfo = await runner.img().info(src.diskPath)
    const linkedInfo = await runner.img().info(linked.diskPath)
    expect(srcInfo.backingFile).toBeTruthy()
    expect(linkedInfo.backingFile).toBe(srcInfo.backingFile)
    // the shared base is read-only so nothing can change it under the overlays
    expect(statSync(srcInfo.backingFile!).mode & 0o200).toBe(0)

    const full = await cloneVm(runner, paths, src, 'clone full', false, [src, linked])
    expect((await runner.img().info(full.diskPath)).backingFile).toBeNull()
    // names are compared like Windows compares file names
    await expect(cloneVm(runner, paths, src, 'CLONE FULL', false, [src, linked, full])).rejects.toThrow(/already exists/)

    for (const c of [src, linked, full]) {
      await runner.start(c)
      await waitFor(runner, c.name, 'running')
      runner.kill(c.name)
      await waitFor(runner, c.name, 'off')
    }
  }, 60_000)

  it('refuses a linked clone of a disk with snapshots and leaves the source alone', async () => {
    const src = vm('snap src')
    await runner.img().create(src.diskPath, 1)
    await runner.img().snapshotCreate(src.diskPath, 'p-1')
    await expect(cloneVm(runner, paths, src, 'snap linked', true, [src])).rejects.toThrow(/profiles/)
    expect(existsSync(join(paths.disks, 'snap linked.qcow2'))).toBe(false)
    const info = await runner.img().info(src.diskPath)
    expect(info.backingFile).toBeNull()
    expect(info.snapshots.map((s) => s.name)).toEqual(['p-1'])
  })

  it('refuses to clone a running VM', async () => {
    const src = vm('busy src')
    await runner.start(src)
    await waitFor(runner, src.name, 'running')
    try {
      await expect(cloneVm(runner, paths, src, 'busy copy', false, [src])).rejects.toThrow(/Power off/)
    } finally {
      runner.kill(src.name)
      await waitFor(runner, src.name, 'off')
    }
  })
})
