import { describe, expect, it } from 'vitest'
import type { VmUsage } from '@shared/ipc'
import { cpuPercent, PowerShellQuery, UsageSampler, type ProcessQuery, type ProcRow } from '../src/main/usage'

describe('cpuPercent', () => {
  it('is zero on the first sample', () => {
    expect(cpuPercent(undefined, { cpuSec: 10, at: 1000 }, 8)).toBe(0)
  })
  it('spreads CPU time over all cores', () => {
    // 4 CPU-seconds in 2 wall seconds on 8 cores = 25% of the machine
    expect(cpuPercent({ cpuSec: 10, at: 0 }, { cpuSec: 14, at: 2000 }, 8)).toBeCloseTo(25)
  })
  it('never goes negative after a counter reset, never above 100', () => {
    expect(cpuPercent({ cpuSec: 10, at: 0 }, { cpuSec: 1, at: 2000 }, 8)).toBe(0)
    expect(cpuPercent({ cpuSec: 0, at: 0 }, { cpuSec: 100, at: 1000 }, 2)).toBe(100)
  })
})

/** answers with whatever rows the test sets */
class FakeQuery implements ProcessQuery {
  rows: ProcRow[] = []
  asked: number[][] = []
  closed = 0
  async query(pids: number[]) {
    this.asked.push(pids)
    return this.rows.filter((r) => pids.includes(r.Id))
  }
  close() {
    this.closed++
  }
}

describe('UsageSampler', () => {
  const MB = 1024 * 1024

  it('reports CPU and memory per VM from two samples', async () => {
    const q = new FakeQuery()
    const got: Record<string, VmUsage>[] = []
    let t = 0
    const s = new UsageSampler(() => new Map([['Kali', 100]]), (u) => got.push(u), 2000, q, 4)
    q.rows = [{ Id: 100, CPU: 10, WS: 512 * MB }]
    await s.tick(() => (t = 0))
    q.rows = [{ Id: 100, CPU: 12, WS: 600 * MB }]
    await s.tick(() => (t = 2000))
    expect(t).toBe(2000)
    expect(got[0]).toEqual({ Kali: { cpuPercent: 0, memMB: 512 } })
    // 2 CPU-seconds in 2 s on 4 cores = 25%
    expect(got[1].Kali.cpuPercent).toBeCloseTo(25)
    expect(got[1].Kali.memMB).toBe(600)
  })

  it('does not ask anything and closes the query while no VM runs', async () => {
    const q = new FakeQuery()
    const s = new UsageSampler(() => new Map(), () => undefined, 2000, q, 4)
    await s.tick()
    expect(q.asked).toEqual([])
    expect(q.closed).toBe(1)
  })

  it('skips a round with no answer instead of reporting zeros', async () => {
    const q = new FakeQuery()
    const got: Record<string, VmUsage>[] = []
    const s = new UsageSampler(() => new Map([['Kali', 100]]), (u) => got.push(u), 2000, q, 4)
    await s.tick()
    expect(got).toEqual([])
  })

  it('forgets a process that is gone, so a reused pid starts fresh', async () => {
    const q = new FakeQuery()
    const got: Record<string, VmUsage>[] = []
    let pids = new Map([['a', 1], ['b', 2]])
    const s = new UsageSampler(() => pids, (u) => got.push(u), 2000, q, 1)
    q.rows = [{ Id: 1, CPU: 5, WS: MB }, { Id: 2, CPU: 50, WS: MB }]
    await s.tick(() => 0)
    // b stops, then a new VM c gets pid 2 with much less CPU time
    pids = new Map([['a', 1]])
    q.rows = [{ Id: 1, CPU: 6, WS: MB }]
    await s.tick(() => 1000)
    pids = new Map([['a', 1], ['c', 2]])
    q.rows = [{ Id: 1, CPU: 7, WS: MB }, { Id: 2, CPU: 1, WS: MB }]
    await s.tick(() => 2000)
    expect(got[2].c.cpuPercent).toBe(0) // first sample of a new process, not a negative delta from b
    expect(got[2].a.cpuPercent).toBeCloseTo(100)
  })

  it('drops an answer that arrives after stop()', async () => {
    let release: (rows: ProcRow[]) => void = () => undefined
    const slow: ProcessQuery = { query: () => new Promise((r) => (release = r)), close: () => undefined }
    const got: unknown[] = []
    const s = new UsageSampler(() => new Map([['a', 1]]), (u) => got.push(u), 2000, slow, 1)
    const pending = s.tick()
    s.stop()
    release([{ Id: 1, CPU: 1, WS: MB }])
    await pending
    expect(got).toEqual([])
  })
})

describe.skipIf(process.platform !== 'win32')('PowerShellQuery', () => {
  it('reads CPU time and memory of a real process', async () => {
    const q = new PowerShellQuery()
    try {
      const rows = await q.query([process.pid])
      expect(rows).toHaveLength(1)
      expect(rows[0].Id).toBe(process.pid)
      expect(rows[0].WS).toBeGreaterThan(1024 * 1024)
      expect(rows[0].CPU).toBeGreaterThan(0)
      // the same PowerShell answers again
      expect(await q.query([process.pid, 999999])).toHaveLength(1)
    } finally {
      q.close()
    }
  }, 30_000)

  it('a closed PowerShell exiting late does not answer the next question', async () => {
    const q = new PowerShellQuery()
    try {
      await q.query([process.pid]) // starts a PowerShell
      q.close() // killed, its exit event comes a bit later
      const rows = await q.query([process.pid]) // asked of a new one right away
      expect(rows).toHaveLength(1)
    } finally {
      q.close()
    }
  }, 30_000)

  it('gives up on a PowerShell that does not answer in time', async () => {
    const q = new PowerShellQuery(1) // no PowerShell starts in 1 ms
    try {
      expect(await q.query([process.pid])).toEqual([])
    } finally {
      q.close()
    }
  }, 30_000)
})
