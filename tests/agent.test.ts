import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { agentCall, agentHibernate } from '../src/main/agent'

let server: Server | null = null

/** fake guest agent: answers each request line with whatever `reply` returns */
function fakeAgent(reply: (req: { execute: string; arguments?: { id?: number } }) => string | null): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((sock) => {
      let buf = ''
      sock.on('data', (d) => {
        buf += d.toString()
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const out = reply(JSON.parse(buf.slice(0, nl)))
          buf = buf.slice(nl + 1)
          if (out !== null) sock.write(out)
        }
      })
    }).listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port))
  })
}

afterEach(() => {
  server?.close()
  server = null
})

describe('guest agent client', () => {
  it('finds the sync reply when it arrives in the same chunk as stale output', async () => {
    const port = await fakeAgent((req) =>
      req.execute === 'guest-sync'
        ? `{"return": {}}\n{"return": ${req.arguments?.id}}\n`
        : '{"return": {"version": "9.2.0"}}\n'
    )
    await expect(agentCall(port, 'guest-info', 2000)).resolves.toEqual({ version: '9.2.0' })
  })

  it('skips half a line left over from an earlier connection', async () => {
    const port = await fakeAgent((req) =>
      req.execute === 'guest-sync' ? `rn": 1}\n{"return": ${req.arguments?.id}}\n` : '{"return": {}}\n'
    )
    await expect(agentCall(port, 'guest-ping', 2000)).resolves.toEqual({})
  })

  it('passes on a refusal to hibernate', async () => {
    const port = await fakeAgent((req) => {
      if (req.execute === 'guest-sync') return `{"return": ${req.arguments?.id}}\n`
      if (req.execute === 'guest-ping') return '{"return": {}}\n'
      return '{"error": {"class": "GenericError", "desc": "no swap"}}\n'
    })
    await expect(agentHibernate(port)).rejects.toThrow(/no swap/)
  })

  it('treats silence after guest-suspend-disk as started', async () => {
    const port = await fakeAgent((req) => {
      if (req.execute === 'guest-sync') return `{"return": ${req.arguments?.id}}\n`
      if (req.execute === 'guest-ping') return '{"return": {}}\n'
      return null
    })
    await expect(agentHibernate(port)).resolves.toBeUndefined()
  }, 8000)
})
