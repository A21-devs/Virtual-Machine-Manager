import { describe, expect, it } from 'vitest'
import { PRESETS, guessPreset, presetById, suggestName } from '@shared/presets'

describe('guessPreset', () => {
  it.each([
    ['C:\\ISOs\\kali-linux-2026.2-installer-amd64.iso', 'kali'],
    ['Parrot-home-7.3_amd64.iso', 'parrot'],
    ['ubuntu-26.04-desktop-amd64.iso', 'ubuntu'],
    ['kubuntu-26.04-desktop-amd64.iso', 'ubuntu'],
    ['linuxmint-22.2-cinnamon-64bit.iso', 'mint'],
    ['Win11_25H2_English_x64.iso', 'windows11'],
    ['Win10_22H2_English_x64v1.iso', 'windows10'],
    ['debian-13.1.0-amd64-netinst.iso', 'debian'],
    ['something.iso', 'other'],
    ['', 'other']
  ])('%s -> %s', (iso, id) => {
    expect(guessPreset(iso).id).toBe(id)
  })

  it('only looks at the file name, not the folders', () => {
    expect(guessPreset('C:\\Users\\kali\\Downloads\\debian-13.iso').id).toBe('debian')
  })
})

describe('presets', () => {
  it('windows presets avoid virtio, which has no drivers during install', () => {
    for (const id of ['windows10', 'windows11']) {
      expect(presetById(id).values).toMatchObject({ os: 'windows', diskBus: 'sata', nic: 'e1000' })
    }
    expect(presetById('windows11').values.firmware).toBe('uefi')
  })

  it('has unique ids and falls back to Other', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length)
    expect(presetById('nope').id).toBe('other')
  })
})

describe('suggestName', () => {
  it('uses the preset label and the next free number', () => {
    expect(suggestName('kali.iso', [])).toBe('Kali Linux')
    expect(suggestName('kali.iso', ['kali linux', 'Kali Linux 2'])).toBe('Kali Linux 3')
    expect(suggestName('mystery.iso', ['New VM'])).toBe('New VM 2')
  })
})

describe('the Other preset', () => {
  it('uses hardware any installer can see, since we know nothing about the OS', () => {
    expect(guessPreset('WindowsServer2025_x64.iso').values).toMatchObject({ os: 'other', diskBus: 'sata', nic: 'e1000', video: 'std' })
  })

  it("matches Windows_11 with an underscore through the 'windows 11' entry", () => {
    expect(guessPreset('Windows_11_ARM_preview.iso').id).toBe('windows11')
  })
})
