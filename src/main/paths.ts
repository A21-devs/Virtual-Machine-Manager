import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'

export interface DataPaths {
  root: string
  vms: string
  disks: string
  isos: string
  logs: string
  qemuDir: string
  /** profile labels, notes and screenshots, one folder per VM */
  profiles: string
}

export function dataPaths(root = join(homedir(), 'VMs')): DataPaths {
  const p = {
    root,
    vms: join(root, 'vms'),
    disks: join(root, 'disks'),
    isos: join(root, 'ISOs'),
    logs: join(root, 'logs'),
    qemuDir: join(root, 'qemu'),
    profiles: join(root, 'profiles')
  }
  for (const d of [p.root, p.vms, p.disks, p.isos, p.logs, p.profiles]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true })
  }
  return p
}

/**
 * The path from settings if one is set (null if it's gone), otherwise the data folder's
 * qemu folder, then the normal install location.
 */
export function findQemu(paths: DataPaths, override = ''): string | null {
  if (override) return existsSync(override) ? override : null
  const candidates = [
    join(paths.qemuDir, 'qemu-system-x86_64.exe'),
    'C:\\Program Files\\qemu\\qemu-system-x86_64.exe'
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

export const qemuImgFor = (qemu: string) => join(dirname(qemu), 'qemu-img.exe')
export const qemuShareFor = (qemu: string) => join(dirname(qemu), 'share')

// per path: Settings can point at a different QEMU while the app runs
const versionCache = new Map<string, string>()

export function qemuVersion(qemu: string): Promise<string | null> {
  if (versionCache.has(qemu)) return Promise.resolve(versionCache.get(qemu) ?? null)
  return new Promise((resolve) => {
    execFile(qemu, ['--version'], { timeout: 5000, windowsHide: true }, (_err, stdout) => {
      const m = /version\s+([\d.]+)/i.exec(String(stdout))
      const v = m ? m[1] : null
      if (v) versionCache.set(qemu, v) // a failed run (timeout) is tried again next time
      resolve(v)
    })
  })
}

const accelCache = new Map<string, 'whpx' | 'tcg'>()

/** Asks QEMU which accelerators it supports. Cached per QEMU, it doesn't change while the app runs. */
export function detectAccel(qemu: string): Promise<'whpx' | 'tcg'> {
  const known = accelCache.get(qemu)
  if (known) return Promise.resolve(known)
  return new Promise((resolve) => {
    execFile(qemu, ['-accel', 'help'], { timeout: 5000, windowsHide: true }, (_err, stdout) => {
      const a = /whpx/i.test(String(stdout)) ? 'whpx' : 'tcg'
      accelCache.set(qemu, a)
      resolve(a)
    })
  })
}
