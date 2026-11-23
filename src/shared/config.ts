// VM config model. Stored as one JSON file per VM in <dataRoot>/vms.
// Has to stay readable for configs written by the old PowerShell version (legacy/).

export type OsType = 'linux' | 'windows' | 'other'
export type Firmware = 'bios' | 'uefi'
export type NetworkMode = 'nat' | 'none'
export type NicModel = 'virtio-net-pci' | 'e1000' | 'rtl8139'
export type DisplayBackend = 'auto' | 'gtk' | 'sdl' | 'none'
export type VideoAdapter = 'qxl' | 'virtio' | 'std' | 'vmware'
export type Accel = 'auto' | 'whpx' | 'tcg'
export type DiskBus = 'virtio' | 'ide' | 'sata'

export interface VmConfig {
  name: string
  os: OsType
  cpus: number
  ramMB: number
  diskPath: string
  diskSizeGB: number
  iso: string
  firmware: Firmware
  network: NetworkMode
  nic: NicModel
  display: DisplayBackend
  video: VideoAdapter
  accel: Accel
  bootFromIso: boolean
  usbTablet: boolean
  extraArgs: string
  // new in v0.1 (not in legacy configs)
  diskBus: DiskBus
}

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback

const int = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export function defaultConfig(name: string, diskDir: string): VmConfig {
  return {
    name,
    os: 'linux',
    cpus: 4,
    ramMB: 4096,
    diskPath: `${diskDir}\\${name}.qcow2`,
    diskSizeGB: 64,
    iso: '',
    firmware: 'bios',
    network: 'nat',
    nic: 'virtio-net-pci',
    display: 'auto',
    video: 'qxl',
    accel: 'auto',
    bootFromIso: true,
    usbTablet: true,
    extraArgs: '',
    diskBus: 'virtio'
  }
}

/**
 * Turns whatever JSON is on disk into a valid VmConfig.
 * Legacy configs have no diskBus. They were installed on IDE, so keep IDE for them
 * instead of silently switching the boot disk to virtio.
 */
export function normalizeConfig(raw: unknown, diskDir: string): VmConfig {
  const r = (raw ?? {}) as Record<string, unknown>
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Untitled VM'
  const d = defaultConfig(name, diskDir)
  return {
    name,
    os: pick(r.os, ['linux', 'windows', 'other'], d.os),
    cpus: int(r.cpus, 1, 64, d.cpus),
    ramMB: int(r.ramMB, 256, 262144, d.ramMB),
    diskPath: typeof r.diskPath === 'string' && r.diskPath ? r.diskPath : d.diskPath,
    diskSizeGB: int(r.diskSizeGB, 1, 16384, d.diskSizeGB),
    iso: typeof r.iso === 'string' ? r.iso : '',
    firmware: pick(r.firmware, ['bios', 'uefi'], d.firmware),
    network: pick(r.network, ['nat', 'none'], d.network),
    nic: pick(r.nic, ['virtio-net-pci', 'e1000', 'rtl8139'], 'e1000'),
    display: pick(r.display, ['auto', 'gtk', 'sdl', 'none'], d.display),
    video: pick(r.video, ['qxl', 'virtio', 'std', 'vmware'], d.video),
    accel: pick(r.accel, ['auto', 'whpx', 'tcg'], d.accel),
    bootFromIso: typeof r.bootFromIso === 'boolean' ? r.bootFromIso : false,
    usbTablet: typeof r.usbTablet === 'boolean' ? r.usbTablet : true,
    extraArgs: typeof r.extraArgs === 'string' ? r.extraArgs : '',
    diskBus: pick(r.diskBus, ['virtio', 'ide', 'sata'], 'ide')
  }
}

/** Names end up in file paths, so only allow what Windows is happy with. */
export function validateVmName(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Name is required'
  if (n.length > 64) return 'Name is too long (64 max)'
  if (/[<>:"/\\|?*\x00-\x1f]/.test(n)) return 'Name has characters Windows does not allow in file names'
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) return 'That name is reserved by Windows'
  if (/[. ]$/.test(n)) return 'Name cannot end with a dot or space'
  return null
}
