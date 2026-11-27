// Grows and compacts disks with real qemu-img, all in a temp folder.
// Run with: npm run test:qemu
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { defaultConfig, type VmConfig } from '@shared/config'
import { cloneVm, compactDisk, resizeDisk } from '../../src/main/disks'
import { dataPaths, findQemu } from '../../src/main/paths'
import { QUICKSAVE, VmRunner } from '../../src/main/vmRunner'

const root = mkdtempSync(join(tmpdir(), 'vmm-disk-'))
const paths = dataPaths(root)
const qemu = findQemu(paths) ?? findQemu(dataPaths())
const GB = 1024 ** 3

const vm = (name: string, extra: Partial<VmConfig> = {}): VmConfig => ({ ...defaultConfig(name, paths.disks), diskSizeGB: 2, ...extra })

describe.skipIf(!qemu)('disk tools with real qemu-img', () => {
  const runner = new VmRunner(paths, () => qemu)

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('grows a disk and refuses to shrink it', async () => {
    const cfg = vm('grow vm')
    await runner.img().create(cfg.diskPath, 2)
    await expect(resizeDisk(runner, cfg, 1)).rejects.toThrow(/only grow/)
    await expect(resizeDisk(runner, cfg, 2.5)).rejects.toThrow(/whole number/)
    await resizeDisk(runner, cfg, 3)
    expect((await runner.img().info(cfg.diskPath)).virtualBytes).toBe(3 * GB)
  })

  it('does nothing to a disk that has not been created yet', async () => {
    const cfg = vm('no disk vm')
    await resizeDisk(runner, cfg, 5)
    expect(existsSync(cfg.diskPath)).toBe(false)
    await expect(compactDisk(runner, cfg)).rejects.toThrow(/no disk file/)
  })

  it('compacts a disk in place and leaves no temp files', async () => {
    const cfg = vm('compact vm')
    await runner.img().create(cfg.diskPath, 2)
    const r = await compactDisk(runner, cfg)
    expect(r.after).toBeGreaterThan(0)
    expect((await runner.img().info(cfg.diskPath)).virtualBytes).toBe(2 * GB)
    expect(existsSync(`${cfg.diskPath}.old`)).toBe(false)
    expect(existsSync(`${cfg.diskPath}.compact.tmp`)).toBe(false)
  })

  it('refuses to resize or compact a disk with a save state, and names it', async () => {
    const cfg = vm('saved vm')
    await runner.img().create(cfg.diskPath, 2)
    await runner.img().snapshotCreate(cfg.diskPath, QUICKSAVE)
    await expect(resizeDisk(runner, cfg, 4)).rejects.toThrow(/save state/)
    await expect(compactDisk(runner, cfg)).rejects.toThrow(/save state/)
    await runner.img().snapshotCreate(cfg.diskPath, 'p1')
    await expect(compactDisk(runner, cfg)).rejects.toThrow(/profiles/)
  })

  it('refuses to compact a linked clone', async () => {
    const src = vm('linked src')
    await runner.img().create(src.diskPath, 1)
    const copy = await cloneVm(runner, paths, src, 'linked copy', true, [src])
    await expect(compactDisk(runner, copy)).rejects.toThrow(/linked clone/)
  })
})
