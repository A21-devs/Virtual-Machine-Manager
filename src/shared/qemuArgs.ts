import type { VmConfig } from './config'

export interface LaunchOptions {
  /** resolved accelerator ('auto' already turned into whpx or tcg) */
  accel: 'whpx' | 'tcg'
  /** directory holding QEMU's firmware files (share/) */
  qemuShareDir: string
  /** localhost TCP port for the QMP control socket */
  qmpPort?: number
  /** internal snapshot to restore on boot (save states) */
  loadState?: string
  /** whether an ISO file actually exists on disk */
  isoExists: boolean
}

/**
 * Builds the qemu-system-x86_64 argument list for a VM.
 *
 * Returns an array that goes straight to child_process.spawn. Never join it into one
 * string: the old PowerShell version did that, and VM names with spaces broke it.
 */
export function buildQemuArgs(cfg: VmConfig, opts: LaunchOptions): string[] {
  const a: string[] = []
  const push = (...xs: string[]) => a.push(...xs)
  const whpx = opts.accel === 'whpx'

  push('-name', `${cfg.name},process=${cfg.name}`)
  push('-machine', whpx ? 'q35,accel=whpx,kernel-irqchip=off' : 'q35,accel=tcg')
  push('-cpu', whpx ? 'max' : 'qemu64')
  // one socket with N cores. Guests schedule this a lot better than N separate sockets.
  push('-smp', `cpus=${cfg.cpus},sockets=1,cores=${cfg.cpus},threads=1`)
  push('-m', String(cfg.ramMB))

  if (cfg.firmware === 'uefi') {
    push('-bios', `${opts.qemuShareDir}\\edk2-x86_64-code.fd`)
  }

  // ---- system disk ----
  // writeback cache + threads aio is the fastest safe combo on Windows hosts
  push(
    '-drive',
    `file=${cfg.diskPath},format=qcow2,if=none,id=disk0,cache=writeback,aio=threads,discard=unmap,detect-zeroes=unmap`
  )
  switch (cfg.diskBus) {
    case 'virtio':
      push('-device', 'virtio-blk-pci,drive=disk0,bootindex=1')
      break
    case 'sata':
      push('-device', 'ide-hd,drive=disk0,bus=ide.0,bootindex=1') // q35 ide.* buses are AHCI (SATA)
      break
    default:
      push('-device', 'ide-hd,drive=disk0,bus=ide.0,bootindex=1')
  }

  // ---- installer ISO ----
  const useIso = Boolean(cfg.iso) && opts.isoExists
  if (useIso) {
    push('-drive', `file=${cfg.iso},if=none,id=cd0,media=cdrom,readonly=on`)
    push('-device', `ide-cd,drive=cd0,bus=ide.1${cfg.bootFromIso ? ',bootindex=0' : ''}`)
  }
  push('-boot', 'menu=on')

  // ---- network ----
  if (cfg.network === 'nat') push('-nic', `user,model=${cfg.nic}`)
  else push('-nic', 'none')

  // ---- graphics ----
  let gl = false
  switch (cfg.video) {
    case 'virtio':
      push('-device', 'virtio-vga-gl')
      gl = true
      break
    case 'std':
      push('-vga', 'std')
      break
    case 'vmware':
      push('-vga', 'vmware')
      break
    default:
      push('-vga', 'qxl')
  }
  const backend = cfg.display === 'auto' ? 'sdl' : cfg.display
  push('-display', gl ? `${backend},gl=on` : backend)

  // ---- input ----
  // xHCI instead of the default UHCI controller: UHCI gets polled constantly and
  // burns host CPU, which is a big part of the "laggy mouse" feeling.
  if (cfg.usbTablet) push('-device', 'qemu-xhci,id=xhci', '-device', 'usb-tablet,bus=xhci.0')

  // ---- misc guest quality of life ----
  push('-rtc', cfg.os === 'windows' ? 'base=localtime,clock=host' : 'base=utc,clock=host')
  if (cfg.os === 'linux') push('-device', 'virtio-balloon-pci')
  push('-device', 'virtio-rng-pci') // faster boot on Linux guests waiting for entropy

  // ---- control socket ----
  if (opts.qmpPort) push('-qmp', `tcp:127.0.0.1:${opts.qmpPort},server=on,wait=off`)

  if (opts.loadState) push('-loadvm', opts.loadState)

  if (cfg.extraArgs.trim()) a.push(...splitArgs(cfg.extraArgs))
  return a
}

/** Splits a user-typed argument string, keeping "quoted parts" together. */
export function splitArgs(input: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) out.push(m[1] ?? m[2])
  return out
}
