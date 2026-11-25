import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { cpus } from 'node:os'
import type { VmUsage } from '@shared/ipc'

/** One process as PowerShell reports it. CPU is total processor seconds so far, WS is bytes. */
export interface ProcRow {
  Id: number
  CPU: number | null
  WS: number
}

export interface ProcessQuery {
  query(pids: number[]): Promise<ProcRow[]>
  close(): void
}

// One long-lived PowerShell that answers each "pid,pid,..." line with one JSON line.
// Starting a new process every 2 seconds would cost more CPU than the VMs being measured.
const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $ids = $line.Split(',') | Where-Object { $_ } | ForEach-Object { [int]$_ }
  $rows = @(Get-Process -Id $ids | ForEach-Object { @{ Id = $_.Id; CPU = $_.CPU; WS = $_.WorkingSet64 } })
  [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject $rows))
}
`

/** Asks a background PowerShell for CPU time and memory of some processes. */
export class PowerShellQuery implements ProcessQuery {
  private ps: ChildProcessWithoutNullStreams | null = null
  private buf = ''
  private waiting: ((rows: ProcRow[]) => void) | null = null

  constructor(private readonly timeoutMs = 10_000) {}

  query(pids: number[]): Promise<ProcRow[]> {
    if (this.waiting) return Promise.resolve([]) // one question at a time
    return new Promise((resolve) => {
      // a PowerShell that stops answering is replaced, otherwise sampling would stop for good
      const timer = setTimeout(() => {
        this.answer([])
        this.close()
      }, this.timeoutMs)
      this.waiting = (rows) => {
        clearTimeout(timer)
        resolve(rows)
      }
      this.proc().stdin.write(pids.join(',') + '\n')
    })
  }

  close(): void {
    this.ps?.kill()
    this.ps = null
    this.buf = ''
    this.answer([])
  }

  private answer(rows: ProcRow[]): void {
    const cb = this.waiting
    this.waiting = null
    cb?.(rows)
  }

  private proc(): ChildProcessWithoutNullStreams {
    if (this.ps && this.ps.exitCode === null) return this.ps
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], { windowsHide: true })
    ps.stdout.setEncoding('utf8')
    ps.stdout.on('data', (d: string) => {
      this.buf += d
      let nl: number
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim()
        this.buf = this.buf.slice(nl + 1)
        let rows: ProcRow[] = []
        try {
          rows = line ? JSON.parse(line) : []
        } catch {
          /* half a line or a PowerShell warning, skip it */
        }
        this.answer(Array.isArray(rows) ? rows : [])
      }
    })
    ps.on('error', () => this.answer([]))
    ps.on('exit', () => {
      if (this.ps === ps) this.ps = null
      this.answer([])
    })
    this.ps = ps
    return ps
  }
}

interface Sample {
  cpuSec: number
  at: number
}

/** Turns two CPU-time samples into a percent of the whole machine. */
export function cpuPercent(prev: Sample | undefined, cur: Sample, cores: number): number {
  if (!prev || cur.at <= prev.at) return 0
  const used = cur.cpuSec - prev.cpuSec
  const wall = (cur.at - prev.at) / 1000
  return Math.max(0, Math.min(100, (used / (wall * cores)) * 100))
}

/**
 * Every intervalMs, measures each running VM's QEMU process and reports
 * { name: { cpuPercent, memMB } }. Does nothing while no VM runs.
 */
export class UsageSampler {
  private last = new Map<number, Sample>()
  private timer: NodeJS.Timeout | null = null
  private generation = 0 // bumped by stop(), so an answer that arrives later is dropped

  constructor(
    private readonly pids: () => Map<string, number>,
    private readonly onUsage: (u: Record<string, VmUsage>) => void,
    private readonly intervalMs = 2000,
    private readonly source: ProcessQuery = new PowerShellQuery(),
    private readonly cores = cpus().length
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), this.intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.generation++
    this.source.close()
  }

  /** One round of sampling. Public so tests don't have to wait for the interval. */
  async tick(now = Date.now): Promise<void> {
    const byName = this.pids()
    if (byName.size === 0) {
      // nothing running, don't keep PowerShell around
      this.source.close()
      this.last.clear()
      return
    }
    const gen = this.generation
    const rows = await this.source.query([...byName.values()])
    // stopped meanwhile, or PowerShell didn't answer: skip this round rather than report zeros
    if (gen !== this.generation || rows.length === 0) return
    const at = now()
    const out: Record<string, VmUsage> = {}
    const seen = new Set<number>()
    for (const [name, pid] of byName) {
      const row = rows.find((r) => r.Id === pid)
      if (!row) continue
      seen.add(pid)
      const cur = { cpuSec: row.CPU ?? 0, at }
      out[name] = { cpuPercent: cpuPercent(this.last.get(pid), cur, this.cores), memMB: Math.round(row.WS / 1024 / 1024) }
      this.last.set(pid, cur)
    }
    // forget processes that are gone, a new VM could get the same pid later
    for (const pid of this.last.keys()) if (!seen.has(pid)) this.last.delete(pid)
    this.onUsage(out)
  }
}
