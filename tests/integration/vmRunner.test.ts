// Boots a real headless VM with no OS (it just sits in the BIOS) and drives it over QMP.
// Needs QEMU installed. Run with: npm run test:qemu
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { defaultConfig } from '@shared/config'
import type { VmRuntimeState } from '@shared/ipc'
import { dataPaths, findQemu } from '../../src/main/paths'
import { UsageSampler } from '../../src/main/usage'
import { VmRunner } from '../../src/main/vmRunner'

const root = mkdtempSync(join(tmpdir(), 'vmm-it-'))
const paths = dataPaths(root)
// use the QEMU from the normal data folder if the temp one has none
const qemu = findQemu(paths) ?? findQemu(dataPaths())

const waitFor = (runner: VmRunner, name: string, status: VmRuntimeState['status'], ms = 15000) =>
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

describe.skipIf(!qemu)('VmRunner with real QEMU', () => {
  const runner = new VmRunner(paths, () => qemu)
  const cfg = {
    ...defaultConfig('it vm with spaces', paths.disks),
    cpus: 1,
    ramMB: 256,
    diskSizeGB: 1,
    display: 'none' as const,
    usbTablet: false
  }

  afterAll(async () => {
    runner.killAll()
    await new Promise((r) => setTimeout(r, 2500))
    rmSync(root, { recursive: true, force: true })
  })

  it('starts, pauses, resumes and force-stops a VM', async () => {
    await runner.start(cfg)
    await waitFor(runner, cfg.name, 'running')
    expect(runner.state(cfg.name).pid).toBeGreaterThan(0)

    await runner.pause(cfg.name)
    await waitFor(runner, cfg.name, 'paused')

    await runner.resume(cfg.name)
    await waitFor(runner, cfg.name, 'running')

    runner.kill(cfg.name)
    await waitFor(runner, cfg.name, 'off')
  })

  it('takes a PNG of the screen for the live preview, and null once it is off', async () => {
    expect(await runner.screenPng(cfg.name)).toBeNull()
    await runner.start(cfg)
    await waitFor(runner, cfg.name, 'running')
    const png = await runner.screenPng(cfg.name)
    expect(png?.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a') // PNG signature
    runner.kill(cfg.name)
    await waitFor(runner, cfg.name, 'off')
    expect(await runner.screenPng(cfg.name)).toBeNull()
  })

  it('measures the memory and CPU of a running VM', async () => {
    await runner.start(cfg)
    await waitFor(runner, cfg.name, 'running')
    const got: Record<string, { cpuPercent: number; memMB: number }>[] = []
    const sampler = new UsageSampler(() => runner.pids(), (u) => got.push(u))
    try {
      await sampler.tick()
      await new Promise((r) => setTimeout(r, 1000))
      await sampler.tick()
    } finally {
      sampler.stop()
      runner.kill(cfg.name)
      await waitFor(runner, cfg.name, 'off')
    }
    expect(got).toHaveLength(2)
    const u = got[1][cfg.name]
    expect(u.memMB).toBeGreaterThan(20) // QEMU itself, the 256 MB guest is mostly untouched in the BIOS
    expect(u.cpuPercent).toBeGreaterThanOrEqual(0)
    expect(u.cpuPercent).toBeLessThanOrEqual(100)
  }, 60_000)
})
