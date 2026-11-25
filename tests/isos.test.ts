import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultConfig } from '@shared/config'
import { listIsos, watchFolder } from '../src/main/isos'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vmm-isos-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const vmWithIso = (name: string, iso: string) => ({ ...defaultConfig(name, 'C:\\VMs\\disks'), iso })

describe('listIsos', () => {
  it('lists .iso files in the folder, any case, and nothing else', () => {
    writeFileSync(join(dir, 'a.iso'), '')
    writeFileSync(join(dir, 'B.ISO'), '')
    writeFileSync(join(dir, 'notes.txt'), '')
    expect(listIsos(dir, []).sort()).toEqual([join(dir, 'B.ISO'), join(dir, 'a.iso')])
  })

  it('adds ISOs a VM uses from somewhere else, but only if they exist', () => {
    const elsewhere = 'D:\\Downloads\\debian.iso'
    const gone = 'D:\\Downloads\\old.iso'
    const isos = listIsos(dir, [vmWithIso('a', elsewhere), vmWithIso('b', gone), vmWithIso('c', '')], (p) => p === elsewhere)
    expect(isos).toEqual([elsewhere])
  })

  it('does not list an ISO twice when a VM points into the folder with other casing', () => {
    writeFileSync(join(dir, 'kali.iso'), '')
    const isos = listIsos(dir, [vmWithIso('a', join(dir, 'KALI.iso'))], () => true)
    expect(isos).toEqual([join(dir, 'kali.iso')])
  })

  it('copes with a missing folder', () => {
    expect(listIsos(join(dir, 'nope'), [])).toEqual([])
  })
})

describe('watchFolder', () => {
  const waitFor = async (check: () => boolean, ms = 3000) => {
    const end = Date.now() + ms
    while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25))
  }

  it('folds a burst of changes into one call', async () => {
    let calls = 0
    const stop = watchFolder(dir, () => calls++, 150)
    try {
      for (let i = 0; i < 5; i++) writeFileSync(join(dir, `f${i}.iso`), 'x')
      await waitFor(() => calls > 0)
      await new Promise((r) => setTimeout(r, 300))
      expect(calls).toBe(1)
    } finally {
      stop()
    }
  })

  it('does not call after it was stopped', async () => {
    let calls = 0
    const stop = watchFolder(dir, () => calls++, 50)
    writeFileSync(join(dir, 'a.iso'), 'x')
    stop() // the pending call is dropped too
    await new Promise((r) => setTimeout(r, 200))
    expect(calls).toBe(0)
  })

  it('returns a no-op for a folder that does not exist', () => {
    const stop = watchFolder(join(dir, 'missing'), () => undefined)
    expect(() => stop()).not.toThrow()
  })

  it('reports a deleted folder once, then stops watching', async () => {
    const sub = join(dir, 'ISOs')
    mkdirSync(sub)
    let calls = 0
    const stop = watchFolder(sub, () => calls++, 50)
    rmSync(sub, { recursive: true, force: true })
    await waitFor(() => calls > 0)
    await new Promise((r) => setTimeout(r, 300))
    expect(calls).toBe(1)
    expect(() => stop()).not.toThrow()
  })
})
