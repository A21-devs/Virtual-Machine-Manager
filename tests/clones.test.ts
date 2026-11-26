import { describe, expect, it } from 'vitest'
import { defaultConfig, type PortForward } from '@shared/config'
import { shiftForwards } from '../src/main/disks'
import { suggestCloneName } from '../src/renderer/src/components/CloneDialog'

const withFwd = (name: string, forwards: PortForward[]) => ({ ...defaultConfig(name, 'C:\\VMs\\disks'), forwards })

describe('shiftForwards', () => {
  it('moves each forward to the next host port no other VM uses', () => {
    const src = withFwd('Kali', [
      { proto: 'tcp', hostPort: 2222, guestPort: 22 },
      { proto: 'udp', hostPort: 2222, guestPort: 53 }
    ])
    const other = withFwd('Parrot', [{ proto: 'tcp', hostPort: 2223, guestPort: 22 }])
    expect(shiftForwards(src.forwards, [src, other])).toEqual([
      { proto: 'tcp', hostPort: 2224, guestPort: 22 }, // 2222 is Kali's, 2223 is Parrot's
      { proto: 'udp', hostPort: 2223, guestPort: 53 } // udp 2223 is free, the tcp one doesn't count
    ])
  })

  it("doesn't give two forwards of the clone the same port", () => {
    const src = withFwd('a', [
      { proto: 'tcp', hostPort: 8080, guestPort: 80 },
      { proto: 'tcp', hostPort: 8081, guestPort: 443 }
    ])
    const out = shiftForwards(src.forwards, [src])
    expect(out.map((f) => f.hostPort)).toEqual([8082, 8083])
  })

  it('leaves forwards alone when nothing else uses the port', () => {
    const f: PortForward[] = [{ proto: 'tcp', hostPort: 3389, guestPort: 3389 }]
    expect(shiftForwards(f, [])).toEqual(f)
  })
})

describe('suggestCloneName', () => {
  it('picks the first free copy name, ignoring case', () => {
    expect(suggestCloneName('Kali', ['Kali'])).toBe('Kali copy')
    expect(suggestCloneName('Kali', ['Kali', 'kali COPY', 'Kali copy 2'])).toBe('Kali copy 3')
  })
})
