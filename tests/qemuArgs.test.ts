import { describe, expect, it } from 'vitest'
import { defaultConfig, type VmConfig } from '@shared/config'
import { buildQemuArgs, splitArgs, type LaunchOptions } from '@shared/qemuArgs'

const base = (over: Partial<VmConfig> = {}): VmConfig => ({ ...defaultConfig('test', 'C:\\VMs\\disks'), ...over })
const opts = (over: Partial<LaunchOptions> = {}): LaunchOptions => ({
  accel: 'whpx',
  qemuShareDir: 'C:\\qemu\\share',
  isoExists: true,
  ...over
})

const valueAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1]

describe('buildQemuArgs', () => {
  it('keeps paths with spaces as single arguments (old PowerShell bug)', () => {
    const args = buildQemuArgs(base({ name: 'Parrot Home', diskPath: 'C:\\VMs\\disks\\Parrot Home.qcow2' }), opts())
    const drive = args.find((a) => a.startsWith('file=C:\\VMs\\disks\\Parrot Home.qcow2'))
    expect(drive).toBeDefined()
  })

  it('uses whpx with kernel-irqchip off when accelerated', () => {
    expect(valueAfter(buildQemuArgs(base(), opts()), '-machine')).toBe('q35,accel=whpx,kernel-irqchip=off')
    expect(valueAfter(buildQemuArgs(base(), opts({ accel: 'tcg' })), '-machine')).toBe('q35,accel=tcg')
  })

  it('puts all cores on one socket', () => {
    expect(valueAfter(buildQemuArgs(base({ cpus: 6 }), opts()), '-smp')).toBe('cpus=6,sockets=1,cores=6,threads=1')
  })

  it('attaches the disk with the chosen bus', () => {
    expect(buildQemuArgs(base({ diskBus: 'virtio' }), opts())).toContain('virtio-blk-pci,drive=disk0,bootindex=1')
    expect(buildQemuArgs(base({ diskBus: 'ide' }), opts())).toContain('ide-hd,drive=disk0,bus=ide.0,bootindex=1')
  })

  it('boots from the ISO only when asked', () => {
    const withBoot = buildQemuArgs(base({ iso: 'C:\\x.iso', bootFromIso: true }), opts())
    const noBoot = buildQemuArgs(base({ iso: 'C:\\x.iso', bootFromIso: false }), opts())
    expect(withBoot).toContain('ide-cd,drive=cd0,bus=ide.1,bootindex=0')
    expect(noBoot).toContain('ide-cd,drive=cd0,bus=ide.1')
  })

  it('skips the cdrom when the ISO file is missing', () => {
    const args = buildQemuArgs(base({ iso: 'C:\\gone.iso' }), opts({ isoExists: false }))
    expect(args.some((a) => a.includes('cd0'))).toBe(false)
  })

  it('uses an xhci usb tablet', () => {
    const args = buildQemuArgs(base(), opts())
    expect(args).toContain('qemu-xhci,id=xhci')
    expect(args).toContain('usb-tablet,bus=xhci.0')
  })

  it('turns on gl only for virtio graphics', () => {
    expect(valueAfter(buildQemuArgs(base({ video: 'virtio', display: 'gtk' }), opts()), '-display')).toBe('gtk,gl=on')
    expect(valueAfter(buildQemuArgs(base({ video: 'qxl', display: 'gtk' }), opts()), '-display')).toBe('gtk')
  })

  it('adds the QMP socket and save state when given', () => {
    const args = buildQemuArgs(base(), opts({ qmpPort: 45000, loadState: 'before-update' }))
    expect(valueAfter(args, '-qmp')).toBe('tcp:127.0.0.1:45000,server=on,wait=off')
    expect(valueAfter(args, '-loadvm')).toBe('before-update')
  })

  it('appends extra args last', () => {
    const args = buildQemuArgs(base({ extraArgs: '-device intel-hda' }), opts())
    expect(args.slice(-2)).toEqual(['-device', 'intel-hda'])
  })
})

describe('splitArgs', () => {
  it('keeps quoted parts together', () => {
    expect(splitArgs('-drive "file=C:\\a b.img" -snapshot')).toEqual(['-drive', 'file=C:\\a b.img', '-snapshot'])
  })
  it('handles empty input', () => {
    expect(splitArgs('   ')).toEqual([])
  })
})
