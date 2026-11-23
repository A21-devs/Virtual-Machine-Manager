import { Socket, connect } from 'node:net'
import { EventEmitter } from 'node:events'

/**
 * Minimal QMP (QEMU Machine Protocol) client.
 * QMP is newline-delimited JSON over a socket. On connect QEMU sends a greeting,
 * we have to send qmp_capabilities before anything else works.
 */
export class QmpClient extends EventEmitter {
  private socket: Socket | null = null
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  constructor(private readonly port: number) {
    super()
  }

  /** Retries until QEMU has opened the socket (it takes a moment after spawn). */
  async connect(timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    let lastErr: unknown
    while (Date.now() < deadline) {
      try {
        await this.tryConnect()
        await this.execute('qmp_capabilities')
        return
      } catch (err) {
        lastErr = err
        this.socket?.destroy()
        this.socket = null
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    throw new Error(`QMP connect failed: ${String(lastErr)}`)
  }

  private tryConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = connect({ host: '127.0.0.1', port: this.port })
      let greeted = false
      s.setEncoding('utf8')
      s.once('error', reject)
      s.on('data', (chunk: string) => {
        this.buffer += chunk
        let nl: number
        while ((nl = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, nl).trim()
          this.buffer = this.buffer.slice(nl + 1)
          if (!line) continue
          let msg: Record<string, unknown>
          try {
            msg = JSON.parse(line)
          } catch {
            continue
          }
          if (!greeted && 'QMP' in msg) {
            greeted = true
            s.off('error', reject)
            s.on('error', (e) => this.emit('error', e))
            this.socket = s
            resolve()
            continue
          }
          this.handle(msg)
        }
      })
      s.on('close', () => {
        for (const p of this.pending.values()) p.reject(new Error('QMP socket closed'))
        this.pending.clear()
        this.emit('close')
      })
    })
  }

  private handle(msg: Record<string, unknown>): void {
    if ('event' in msg) {
      this.emit('event', msg.event, msg.data)
      return
    }
    const id = typeof msg.id === 'number' ? msg.id : -1
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    if ('error' in msg) {
      const e = msg.error as { desc?: string }
      p.reject(new Error(e.desc ?? 'QMP error'))
    } else {
      p.resolve(msg.return)
    }
  }

  execute<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (!this.socket) return Promise.reject(new Error('QMP not connected'))
    const id = this.nextId++
    const payload = JSON.stringify(args ? { execute: command, arguments: args, id } : { execute: command, id })
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.socket!.write(payload + '\n')
    })
  }

  /** Runs an old-style monitor command (needed for savevm/loadvm/delvm). */
  hmp(commandLine: string): Promise<string> {
    return this.execute<string>('human-monitor-command', { 'command-line': commandLine })
  }

  close(): void {
    this.socket?.destroy()
    this.socket = null
  }
}
