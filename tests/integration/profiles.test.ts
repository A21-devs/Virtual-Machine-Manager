// Profiles against real QEMU, all inside a temp folder. Run with: npm run test:qemu
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { defaultConfig, type VmConfig } from '@shared/config'
import type { VmRuntimeState } from '@shared/ipc'
import { dataPaths, findQemu } from '../../src/main/paths'
import { Profiles } from '../../src/main/profiles'
import { QUICKSAVE, VmRunner } from '../../src/main/vmRunner'

const root = mkdtempSync(join(tmpdir(), 'vmm-prof-'))
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

const vm = (name: string): VmConfig => ({
  ...defaultConfig(name, paths.disks),
  cpus: 1,
  ramMB: 256,
  diskSizeGB: 1,
  display: 'none',
  usbTablet: false,
  network: 'none'
})

describe.skipIf(!qemu)('profiles with real QEMU', () => {
  const runner = new VmRunner(paths, () => qemu)
  const profiles = new Profiles(paths, runner)

  afterAll(async () => {
    runner.killAll()
    await new Promise((r) => setTimeout(r, 2500))
    rmSync(root, { recursive: true, force: true })
  })

  it('asks for guest setup when the agent is missing and leaves the VM running', async () => {
    const cfg = vm('agentless vm')
    await expect(profiles.take(cfg, 'x', '')).rejects.toThrow(/Power the VM on/)
    await runner.start(cfg)
    await waitFor(runner, cfg.name, 'running')
    // no OS inside, so no guest agent answers
    await expect(profiles.take(cfg, 'live', '')).rejects.toThrow(/needs-guest-setup/)
    expect(runner.isRunning(cfg.name)).toBe(true)
    expect(await profiles.list(cfg)).toEqual([])
    runner.kill(cfg.name)
    await waitFor(runner, cfg.name, 'off')
  })

  it('lists, launches, edits and removes profiles', async () => {
    const cfg = vm('profile vm')
    await runner.start(cfg) // creates the disk
    await waitFor(runner, cfg.name, 'running')
    runner.kill(cfg.name)
    await waitFor(runner, cfg.name, 'off')
    // stand-ins for saved sessions, plus a save state that must stay out of the list
    await runner.img().snapshotCreate(cfg.diskPath, 'first')
    await runner.img().snapshotCreate(cfg.diskPath, 'second')
    await runner.img().snapshotCreate(cfg.diskPath, QUICKSAVE)
    expect((await profiles.list(cfg)).map((p) => p.tag).sort()).toEqual(['first', 'second'])
    expect((await profiles.list(cfg)).every((p) => p.kind === 'disk' && !p.hasShot)).toBe(true)

    // launch while off: rolls back and boots
    await profiles.launch(cfg, 'first', false)
    await waitFor(runner, cfg.name, 'running')
    await expect(profiles.restore(cfg, 'second')).rejects.toThrow(/Power off/)
    // launch while on needs force, then turns it off first
    await expect(profiles.launch(cfg, 'second', false)).rejects.toThrow(/vm-running/)
    await profiles.launch(cfg, 'second', true)
    await waitFor(runner, cfg.name, 'running')

    // removing works while running too
    await profiles.remove(cfg, 'first')
    runner.kill(cfg.name)
    await waitFor(runner, cfg.name, 'off')
    await expect(profiles.restore(cfg, 'first')).rejects.toThrow(/no longer exists/)

    profiles.edit(cfg, 'second', ' renamed ', 'a note')
    expect(await profiles.list(cfg)).toMatchObject([{ tag: 'second', label: 'renamed', note: 'a note' }])

    profiles.rename(cfg.name, 'profile vm 2')
    expect((await profiles.list({ ...cfg, name: 'profile vm 2' }))[0].label).toBe('renamed')
  })
})
