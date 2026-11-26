import { describe, expect, it } from 'vitest'
import type { PortForward } from '@shared/config'
import { forwardError } from '../src/renderer/src/components/PortForwards'

const tcp = (hostPort: number, guestPort = 22): PortForward => ({ proto: 'tcp', hostPort, guestPort })

describe('forwardError', () => {
  it('accepts a normal list', () => {
    const list = [tcp(2222), { proto: 'udp' as const, hostPort: 2222, guestPort: 53 }]
    expect(forwardError(list, 0)).toBeNull()
    expect(forwardError(list, 1)).toBeNull() // same number, other protocol
  })

  it('flags empty and out of range ports', () => {
    expect(forwardError([tcp(Number.NaN)], 0)).toMatch(/1 to 65535/)
    expect(forwardError([tcp(70000)], 0)).toMatch(/1 to 65535/)
    expect(forwardError([tcp(2222, 0)], 0)).toMatch(/1 to 65535/)
  })

  it('flags the second use of a host port, not the first', () => {
    const list = [tcp(2222), tcp(2222, 23)]
    expect(forwardError(list, 0)).toBeNull()
    expect(forwardError(list, 1)).toBe('TCP 2222 is used twice')
  })
})
