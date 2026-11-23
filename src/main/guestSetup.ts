import { createServer, type Server } from 'node:http'
import script from '../../resources/guest/setup-save-state.sh?raw'

/**
 * Serves the one-time guest setup script on the host's loopback. With QEMU's NAT
 * networking the guest reaches the host's 127.0.0.1 at 10.0.2.2, so the user can
 * run one curl command inside the VM without downloading anything by hand.
 */
export class GuestSetupServer {
  private server: Server | null = null
  /** cached so overlapping calls share one server instead of each making their own */
  private starting: Promise<number> | null = null

  start(): Promise<number> {
    this.starting ??= this.listen().catch((e) => {
      this.starting = null
      throw e
    })
    return this.starting
  }

  private async listen(): Promise<number> {
    const server = createServer((req, res) => {
      if (req.method === 'GET' && (req.url === '/s' || req.url === '/setup-save-state.sh')) {
        res.writeHead(200, { 'Content-Type': 'text/x-shellscript; charset=utf-8' })
        res.end(script.replace(/\r\n/g, '\n'))
        return
      }
      res.writeHead(404).end()
    })
    // a fixed short port so the command is easy to type inside the VM (no clipboard there)
    const listen = (port: number) =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => resolve())
      })
    await listen(7777).catch(() => listen(0))
    server.unref() // never what keeps the app from quitting
    this.server = server
    return (server.address() as { port: number }).port
  }

  async command(): Promise<string> {
    const port = await this.start()
    return `curl -sL 10.0.2.2:${port}/s | sudo bash`
  }

  close(): void {
    this.server?.close()
    this.server = null
    this.starting = null
  }
}
