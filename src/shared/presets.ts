import type { VmConfig } from './config'

export interface Preset {
  id: string
  label: string
  /** lowercase bits of an ISO file name that point at this preset */
  match: string[]
  values: Pick<VmConfig, 'os' | 'cpus' | 'ramMB' | 'diskSizeGB' | 'firmware' | 'video' | 'nic' | 'diskBus'>
}

const linux = { os: 'linux', firmware: 'bios', video: 'qxl', nic: 'virtio-net-pci', diskBus: 'virtio' } as const

export const PRESETS: Preset[] = [
  { id: 'kali', label: 'Kali Linux', match: ['kali'], values: { ...linux, cpus: 4, ramMB: 4096, diskSizeGB: 80 } },
  { id: 'parrot', label: 'Parrot OS', match: ['parrot'], values: { ...linux, cpus: 4, ramMB: 4096, diskSizeGB: 64 } },
  // before Ubuntu, a Mint VM shouldn't be suggested the name Ubuntu
  { id: 'mint', label: 'Linux Mint', match: ['linuxmint', 'linux mint'], values: { ...linux, cpus: 4, ramMB: 4096, diskSizeGB: 64 } },
  { id: 'ubuntu', label: 'Ubuntu', match: ['ubuntu', 'kubuntu', 'xubuntu'], values: { ...linux, cpus: 4, ramMB: 4096, diskSizeGB: 64 } },
  { id: 'debian', label: 'Debian', match: ['debian'], values: { ...linux, cpus: 2, ramMB: 2048, diskSizeGB: 32 } },
  {
    id: 'windows11',
    label: 'Windows 11',
    match: ['win11', 'windows 11', 'windows11', 'win_11'],
    // Windows has no virtio drivers out of the box, so stay on SATA + e1000 for the install
    values: { os: 'windows', cpus: 4, ramMB: 8192, diskSizeGB: 128, firmware: 'uefi', video: 'std', nic: 'e1000', diskBus: 'sata' }
  },
  {
    id: 'windows10',
    label: 'Windows 10',
    match: ['win10', 'windows 10', 'windows10', 'win_10'],
    values: { os: 'windows', cpus: 4, ramMB: 4096, diskSizeGB: 64, firmware: 'bios', video: 'std', nic: 'e1000', diskBus: 'sata' }
  },
  { id: 'other', label: 'Other', match: [], values: { ...linux, os: 'other', cpus: 2, ramMB: 2048, diskSizeGB: 32 } }
]

export function presetById(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[PRESETS.length - 1]
}

/** Guesses the preset from an ISO path, e.g. "kali-linux-2026.2-installer-amd64.iso" -> kali. */
export function guessPreset(isoPath: string): Preset {
  const file = (isoPath.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/[-_.]+/g, ' ')
  const squashed = file.replace(/\s+/g, '')
  for (const p of PRESETS) {
    if (p.match.some((m) => file.includes(m) || squashed.includes(m.replace(/\s+/g, '')))) return p
  }
  return presetById('other')
}

/** Suggests a VM name from an ISO file, e.g. "Kali" or "Windows 11". Falls back to the preset label. */
export function suggestName(isoPath: string, taken: string[]): string {
  const base = guessPreset(isoPath)
  const root = base.id === 'other' ? 'New VM' : base.label
  const lower = new Set(taken.map((t) => t.toLowerCase()))
  if (!lower.has(root.toLowerCase())) return root
  let i = 2
  while (lower.has(`${root} ${i}`.toLowerCase())) i++
  return `${root} ${i}`
}
