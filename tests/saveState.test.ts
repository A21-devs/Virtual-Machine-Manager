import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@shared/config'
import { buildQemuArgs } from '@shared/qemuArgs'
import { parseInfo } from '../src/main/qemuImg'

const opts = { accel: 'whpx' as const, qemuShareDir: 'C:\qemu\share', isoExists: false }

describe('guest agent channel', () => {
  it('is added only when given a port', () => {
    expect(buildQemuArgs(defaultConfig('a', 'C:\VMs\disks'), opts)).not.toContain('virtio-serial-pci')
    const a = buildQemuArgs(defaultConfig('a', 'C:\VMs\disks'), { ...opts, agentPort: 40123 })
    expect(a).toContain('socket,id=qga0,host=127.0.0.1,port=40123,server=on,wait=off')
    expect(a).toContain('virtserialport,chardev=qga0,name=org.qemu.guest_agent.0')
  })
})

describe('qemu-img info parsing', () => {
  it('reads sizes, backing file and snapshots', () => {
    const info = parseInfo(
      JSON.stringify({
        'virtual-size': 68719476736,
        'actual-size': 5368709120,
        'full-backing-filename': 'C:\VMs\disks\Kali.base-x.qcow2',
        snapshots: [
          { id: '1', name: 'p1', 'vm-state-size': 0, 'date-sec': 1795456323 },
          { id: '2', name: 'vmm-quicksave', 'vm-state-size': 1234, 'date-sec': 1795456400 }
        ]
      })
    )
    expect(info).toMatchObject({ virtualBytes: 68719476736, actualBytes: 5368709120, backingFile: 'C:\VMs\disks\Kali.base-x.qcow2' })
    expect(info.snapshots[1]).toEqual({ name: 'vmm-quicksave', vmStateSize: 1234, dateSec: 1795456400 })
  })

  it('handles a plain disk', () => {
    expect(parseInfo('{"virtual-size":1,"actual-size":2}')).toMatchObject({ backingFile: null, snapshots: [] })
  })
})
