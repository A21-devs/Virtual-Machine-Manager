import { describe, expect, it } from 'vitest'
import { defaultConfig, normalizeConfig, normalizeForwards, validateVmName } from '@shared/config'

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

  it('leaves auto-start off for configs that predate it', () => {
    const cfg = normalizeConfig({ name: 'Kali', cpus: 4 }, DISKS)
    expect(cfg).toMatchObject({ autostart: false, resumeLast: false })
    // only a real true turns it on, not a truthy string from a hand-edited file
    expect(normalizeConfig({ name: 'Kali', autostart: 'yes', resumeLast: 1 }, DISKS)).toMatchObject({ autostart: false, resumeLast: false })
    expect(normalizeConfig({ name: 'Kali', autostart: true, resumeLast: true }, DISKS)).toMatchObject({ autostart: true, resumeLast: true })
  })

  it('survives null', () => {
    expect(normalizeConfig(null, DISKS).name).toBe('Untitled VM')
  })

  it('has no port forwards for configs that predate them', () => {
    expect(normalizeConfig({ name: 'Kali' }, DISKS).forwards).toEqual([])
    expect(normalizeConfig({ name: 'Kali', forwards: 'ssh' }, DISKS).forwards).toEqual([])
  })
})

describe('normalizeForwards', () => {
  it('drops broken entries and duplicate host ports', () => {
    const f = normalizeForwards([
      { proto: 'tcp', hostPort: 2222, guestPort: 22 },
      { proto: 'tcp', hostPort: 2222, guestPort: 23 }, // same host port twice, QEMU would refuse to start
      { proto: 'udp', hostPort: 2222, guestPort: 53 }, // same port on the other protocol is fine
      { proto: 'tcp', hostPort: 0, guestPort: 22 },
      { proto: 'tcp', hostPort: 70000, guestPort: 22 },
      { proto: 'tcp', hostPort: 8080.5, guestPort: 80 },
      null,
      'ssh',
      { proto: 'weird', hostPort: '8080', guestPort: '80' } // hand-edited file: strings and an unknown protocol
    ])
    expect(f).toEqual([
      { proto: 'tcp', hostPort: 2222, guestPort: 22 },
      { proto: 'udp', hostPort: 2222, guestPort: 53 },
      { proto: 'tcp', hostPort: 8080, guestPort: 80 }
    ])
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
