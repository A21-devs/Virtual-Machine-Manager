import { connect, type Socket } from 'node:net'

/**
 * Talks to qemu-guest-agent inside the guest over the virtio-serial channel that
 * buildQemuArgs adds. Needs the qemu-guest-agent package installed in the guest.
 *
 * The agent protocol is newline-delimited JSON like QMP, but with no greeting.
 * guest-sync with a random id flushes any stale output from an earlier connection.
 */
export async function agentCall<T = unknown>(port: number, command: string, timeoutMs = 4000): Promise<T> {
  const s = await open(port, timeoutMs)
  try {
    const lines = new Lines(s)
    const syncId = Math.floor(Math.random() * 1e9)
    await request(s, lines, { execute: 'guest-sync', arguments: { id: syncId } }, timeoutMs, (m) => m.return === syncId)
    return (await request(s, lines, { execute: command }, timeoutMs, () => true)).return as T
  } finally {
    s.destroy()
  }
}

/**
 * Asks the guest to hibernate (suspend to its own disk). QEMU then exits by itself, and
 * the next normal boot brings the guest session back. guest-suspend-disk never replies
 * on success, so a closed socket or a timeout after sending counts as "started".
 */
export async function agentHibernate(port: number): Promise<void> {
  await agentCall(port, 'guest-ping', 3000).catch(() => {
    throw new Error(
      'The guest agent is not answering. Install qemu-guest-agent in the guest (Kali/Parrot: sudo apt install qemu-guest-agent) and make sure the guest has swap at least as big as its RAM.'
    )
  })
  const s = await open(port, 3000)
  try {
    const lines = new Lines(s)
    s.write(JSON.stringify({ execute: 'guest-suspend-disk' }) + '\n')
    const reply = await lines.next(3000).catch(() => null)
    if (reply) {
      let msg: { error?: { desc?: string } } = {}
      try {
        msg = JSON.parse(reply) as typeof msg
      } catch {
        /* not a reply we understand, the guest is most likely already going down */
      }
      if (msg.error) throw new Error(`Guest refused to hibernate: ${msg.error.desc ?? 'unknown error'}`)
    }
  } finally {
    s.destroy()
  }
}

function open(port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect({ host: '127.0.0.1', port })
    s.setEncoding('utf8')
    const t = setTimeout(() => {
      s.destroy()
      reject(new Error('guest agent connect timed out'))
    }, timeoutMs)
    s.once('connect', () => {
      clearTimeout(t)
      resolve(s)
    })
    s.once('error', (e) => {
      clearTimeout(t)
      reject(e)
    })
  })
}

/**
 * Reads newline-delimited replies off the socket. One buffer per socket, so a chunk
 * holding two replies (a stale one plus the sync reply, say) doesn't lose the second.
 */
class Lines {
  private buf = ''
  private queue: string[] = []
  private closed = false
  private wake: (() => void) | null = null

  constructor(s: Socket) {
    s.on('data', (d: string) => {
      this.buf += d
      let nl: number
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim()
        this.buf = this.buf.slice(nl + 1)
        if (line) this.queue.push(line)
      }
      this.wake?.()
    })
    s.on('close', () => {
      this.closed = true
      this.wake?.()
    })
  }

  async next(timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const line = this.queue.shift()
      if (line !== undefined) return line
      if (this.closed) throw new Error('closed')
      const left = deadline - Date.now()
      if (left <= 0) throw new Error('timeout')
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left)
        this.wake = () => {
          clearTimeout(t)
          resolve()
        }
      })
      this.wake = null
    }
  }
}

async function request(
  s: Socket,
  lines: Lines,
  payload: unknown,
  timeoutMs: number,
  accept: (m: Record<string, unknown>) => boolean
): Promise<Record<string, unknown>> {
  s.write(JSON.stringify(payload) + '\n')
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const line = await lines.next(Math.max(1, deadline - Date.now()))
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue // half a reply left over from an earlier connection
    }
    if (msg.error) throw new Error((msg.error as { desc?: string }).desc ?? 'guest agent error')
    if (accept(msg)) return msg
  }
}
