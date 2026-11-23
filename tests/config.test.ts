import { describe, expect, it } from 'vitest'
import { defaultConfig, normalizeConfig, validateVmName } from '@shared/config'

const DISKS = 'C:\\VMs\\disks'

describe('normalizeConfig', () => {
  it('reads a config written by the legacy PowerShell app', () => {
    const legacy = {
      name: 'Parrot Home',
      os: 'linux',
      cpus: 8,
      ramMB: 8192,
      diskPath: 'C:\\VMs\\disks\\Parrot Home.qcow2',
      diskSizeGB: 100,
      iso: 'C:\\VMs\\ISOs\\Parrot-home-7.3_amd64.iso',
      firmware: 'bios',
      network: 'nat',
      nic: 'e1000',
      display: 'auto',
      video: 'qxl',
      accel: 'auto',
      bootFromIso: true,
      usbTablet: true,
      extraArgs: ''
    }
    const cfg = normalizeConfig(legacy, DISKS)
    expect(cfg.name).toBe('Parrot Home')
    expect(cfg.cpus).toBe(8)
    expect(cfg.nic).toBe('e1000')
    // legacy VMs were installed on IDE, keep it that way
    expect(cfg.diskBus).toBe('ide')
  })

  it('fills in defaults and clamps junk values', () => {
    const cfg = normalizeConfig({ name: 'x', cpus: 999, ramMB: 'lots', video: 'rainbow' }, DISKS)
    expect(cfg.cpus).toBe(64)
    expect(cfg.ramMB).toBe(defaultConfig('x', DISKS).ramMB)
    expect(cfg.video).toBe('qxl')
  })

  it('survives null', () => {
    expect(normalizeConfig(null, DISKS).name).toBe('Untitled VM')
  })
})

describe('validateVmName', () => {
  it('accepts normal names with spaces', () => {
    expect(validateVmName('Parrot Home')).toBeNull()
  })
  it.each(['', '   ', 'a/b', 'what?', 'CON', 'trailing.', 'x'.repeat(65)])('rejects %j', (n) => {
    expect(validateVmName(n)).not.toBeNull()
  })
})
