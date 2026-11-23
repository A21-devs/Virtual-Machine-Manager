// Save state against real QEMU, all inside a temp folder. Run with: npm run test:qemu
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { defaultConfig, type VmConfig } from '@shared/config'
import type { VmRuntimeState } from '@shared/ipc'
import { agentHibernate } from '../../src/main/agent'
import { dataPaths, findQemu } from '../../src/main/paths'
import { QUICKSAVE, VmRunner } from '../../src/main/vmRunner'

const root = mkdtempSync(join(tmpdir(), 'vmm-save-'))
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

describe.skipIf(!qemu)('save states with real QEMU', () => {
  const runner = new VmRunner(paths, () => qemu)
  const crashes: string[] = []
  runner.on('crash', (c: { name: string }) => crashes.push(c.name))

  afterAll(async () => {
    runner.killAll()
    await new Promise((r) => setTimeout(r, 2500))
    rmSync(root, { recursive: true, force: true })
  })

  it('save state round trip works without WHPX', async () => {
    const cfg = vm('tcg vm', { accel: 'tcg' })
    await runner.start(cfg)
    await waitFor(runner, cfg.name, 'running')
    await runner.saveAndQuit(cfg.name)
    expect(runner.isRunning(cfg.name)).toBe(false)
    expect(await runner.hasSaveState(cfg)).toBe(true)

    await runner.start(cfg, { loadState: QUICKSAVE })
    await waitFor(runner, cfg.name, 'running')
    await runner.deleteSnapshotLive(cfg.name, QUICKSAVE)
    expect(await runner.hasSaveState(cfg)).toBe(false)
    runner.kill(cfg.name)
    await waitFor(runner, cfg.name, 'off')
    // quitting on purpose right after boot is not a crash
    expect(crashes).not.toContain(cfg.name)
  })

  it('refuses a RAM save under WHPX with a clear reason', async (ctx) => {
    const cfg = vm('whpx vm', { accel: 'auto' })
    await runner.start(cfg)
    await waitFor(runner, cfg.name, 'running')
    try {
      if (runner.accelOf(cfg.name) !== 'whpx') ctx.skip()
      await expect(runner.saveAndQuit(cfg.name)).rejects.toThrow(/WHPX/)
      expect(runner.isRunning(cfg.name)).toBe(true)
    } finally {
      runner.kill(cfg.name)
      await waitFor(runner, cfg.name, 'off')
    }
  })

  it('the guest agent gives a clear error when nothing answers', async () => {
    const cfg = vm('agent vm')
    await runner.start(cfg)
    await waitFor(runner, cfg.name, 'running')
    await expect(agentHibernate(runner.agentPortOf(cfg.name))).rejects.toThrow(/qemu-guest-agent/)
    runner.kill(cfg.name)
    await waitFor(runner, cfg.name, 'off')
  })
})
