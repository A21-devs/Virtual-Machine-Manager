import { createSocket } from 'node:dgram'
import { createServer, type AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { isPortFree } from '../src/main/vmRunner'

describe('isPortFree', () => {
  it('sees a tcp port that is being listened on', async () => {
    const srv = createServer()
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
    const port = (srv.address() as AddressInfo).port
    try {
      expect(await isPortFree(port, 'tcp')).toBe(false)
    } finally {
      await new Promise((r) => srv.close(r))
    }
    expect(await isPortFree(port, 'tcp')).toBe(true)
  })

  it('sees a udp port that is bound', async () => {
    const sock = createSocket('udp4')
    await new Promise<void>((r) => sock.bind(0, '127.0.0.1', () => r()))
    const port = sock.address().port
    try {
      expect(await isPortFree(port, 'udp')).toBe(false)
      // Do not assume the TCP side of this port is free: binding UDP on port 0
      // only reserves the UDP port, and the OS may hand the same number to a
      // TCP socket from the shared ephemeral range on this machine.
    } finally {
      await new Promise<void>((r) => sock.close(() => r()))
    }
    expect(await isPortFree(port, 'udp')).toBe(true)
  })
})
