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
}

export function dataPaths(root = join(homedir(), 'VMs')): DataPaths {
  const p = {
    root,
    vms: join(root, 'vms'),
    disks: join(root, 'disks'),
    isos: join(root, 'ISOs'),
    logs: join(root, 'logs'),
    qemuDir: join(root, 'qemu')
  }
  for (const d of [p.root, p.vms, p.disks, p.isos, p.logs]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true })
  }
  return p
}

/** Looks for QEMU in the data folder first, then the normal install locations. */
export function findQemu(paths: DataPaths): string | null {
  const candidates = [
    join(paths.qemuDir, 'qemu-system-x86_64.exe'),
    'C:\\Program Files\\qemu\\qemu-system-x86_64.exe'
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

export const qemuImgFor = (qemu: string) => join(dirname(qemu), 'qemu-img.exe')
export const qemuShareFor = (qemu: string) => join(dirname(qemu), 'share')

let versionCache: string | null = null

export function qemuVersion(qemu: string): Promise<string | null> {
  if (versionCache) return Promise.resolve(versionCache)
  return new Promise((resolve) => {
    execFile(qemu, ['--version'], { timeout: 5000, windowsHide: true }, (_err, stdout) => {
      const m = /version\s+([\d.]+)/i.exec(String(stdout))
      versionCache = m ? m[1] : null
      resolve(versionCache)
    })
  })
}

let accelCache: 'whpx' | 'tcg' | null = null

/** Asks QEMU which accelerators it supports. Cached, it doesn't change while the app runs. */
export function detectAccel(qemu: string): Promise<'whpx' | 'tcg'> {
  if (accelCache) return Promise.resolve(accelCache)
  return new Promise((resolve) => {
    execFile(qemu, ['-accel', 'help'], { timeout: 5000, windowsHide: true }, (_err, stdout) => {
      accelCache = /whpx/i.test(String(stdout)) ? 'whpx' : 'tcg'
      resolve(accelCache)
    })
  })
}
