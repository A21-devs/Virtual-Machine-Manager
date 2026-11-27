import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { freeDiskPath } from '../src/main/store'

describe('freeDiskPath', () => {
  const dir = join('C:', 'VMs', 'disks')
  const none = () => false

  it('names the disk after the VM when nothing is there', () => {
    expect(freeDiskPath(dir, 'Kali Linux', [], none)).toBe(join(dir, 'Kali Linux.qcow2'))
  })

  it('skips a disk file left behind by a removed VM', () => {
    const left = new Set([join(dir, 'Kali Linux.qcow2'), join(dir, 'Kali Linux (2).qcow2')])
    expect(freeDiskPath(dir, 'Kali Linux', [], (p) => left.has(p))).toBe(join(dir, 'Kali Linux (3).qcow2'))
  })

  it("skips the disk of another VM that hasn't been started yet, ignoring case", () => {
    // a VM made as "Kali Linux" and renamed before its first boot still points at that file
    const used = [join(dir, 'KALI LINUX.qcow2')]
    expect(freeDiskPath(dir, 'Kali Linux', used, none)).toBe(join(dir, 'Kali Linux (2).qcow2'))
  })
})
