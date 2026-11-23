import { afterEach, describe, expect, it } from 'vitest'
import { GuestSetupServer } from '../src/main/guestSetup'

describe('guest setup server', () => {
  const srv = new GuestSetupServer()
  afterEach(() => srv.close())

  it('gives a short command and serves the script on the host loopback', async () => {
    const cmd = await srv.command()
    expect(cmd).toMatch(/^curl -sL 10\.0\.2\.2:\d+\/s \| sudo bash$/)
    const port = Number(/:(\d+)\//.exec(cmd)![1])
    const res = await fetch(`http://127.0.0.1:${port}/s`)
    const body = await res.text()
    expect(res.status).toBe(200)
    expect(body.startsWith('#!/bin/bash')).toBe(true)
    expect(body).toContain('qemu-guest-agent')
    expect(body).not.toContain('\r')
    expect((await fetch(`http://127.0.0.1:${port}/other`)).status).toBe(404)
  })
})
