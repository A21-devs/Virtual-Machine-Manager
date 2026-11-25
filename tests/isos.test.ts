import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultConfig } from '@shared/config'
import { importIso, listIsos, watchFolder } from '../src/main/isos'

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

describe('importIso', () => {
  let src: string
  let isos: string
  beforeEach(() => {
    src = join(dir, 'Downloads')
    isos = join(dir, 'ISOs')
    mkdirSync(src)
    mkdirSync(isos)
  })

  it('rejects anything that is not an existing .iso', async () => {
    writeFileSync(join(src, 'setup.exe'), 'x')
    await expect(importIso(join(src, 'setup.exe'), isos, 'copy')).rejects.toThrow(/\.iso/)
    await expect(importIso(join(src, 'gone.iso'), isos, 'reference')).rejects.toThrow(/does not exist/)
    mkdirSync(join(src, 'folder.iso'))
    await expect(importIso(join(src, 'folder.iso'), isos, 'reference')).rejects.toThrow(/does not exist/)
  })

  it('references the file where it is', async () => {
    const file = join(src, 'debian.iso')
    writeFileSync(file, 'abc')
    expect(await importIso(file, isos, 'reference')).toBe(file)
    expect(readdirSync(isos)).toEqual([])
  })

  it('copies into the ISOs folder without leaving a .part file', async () => {
    const file = join(src, 'debian.iso')
    writeFileSync(file, 'abc')
    const out = await importIso(file, isos, 'copy')
    expect(out).toBe(join(isos, 'debian.iso'))
    expect(readFileSync(out, 'utf8')).toBe('abc')
    expect(readdirSync(isos)).toEqual(['debian.iso'])
  })

  it('reuses the same ISO dropped twice, numbers a different one with the same name', async () => {
    writeFileSync(join(isos, 'debian.iso'), 'abc')
    writeFileSync(join(src, 'debian.iso'), 'abc')
    expect(await importIso(join(src, 'debian.iso'), isos, 'copy')).toBe(join(isos, 'debian.iso'))
    writeFileSync(join(src, 'debian.iso'), 'a newer build')
    expect(await importIso(join(src, 'debian.iso'), isos, 'copy')).toBe(join(isos, 'debian (2).iso'))
    expect(readFileSync(join(isos, 'debian (2).iso'), 'utf8')).toBe('a newer build')
  })

  it('returns a file that is already in the ISOs folder as is', async () => {
    const file = join(isos, 'kali.iso')
    writeFileSync(file, 'abc')
    expect(await importIso(file, isos, 'copy')).toBe(file)
    expect(readdirSync(isos)).toEqual(['kali.iso'])
  })
})

describe('importIso while a copy is running', () => {
  let src: string
  let isos: string
  beforeEach(() => {
    src = join(dir, 'Downloads')
    isos = join(dir, 'ISOs')
    mkdirSync(src)
    mkdirSync(isos)
  })

  it('shares one copy when the same file is dropped twice at once', async () => {
    const file = join(src, 'win.iso')
    writeFileSync(file, Buffer.alloc(8 * 1024 * 1024, 1))
    const [a, b] = await Promise.all([importIso(file, isos, 'copy'), importIso(file, isos, 'copy')])
    expect(a).toBe(join(isos, 'win.iso'))
    expect(b).toBe(a)
    expect(readdirSync(isos)).toEqual(['win.iso'])
  })

  it('gives a different file with the same name its own copy', async () => {
    const other = join(dir, 'Other')
    mkdirSync(other)
    writeFileSync(join(src, 'win.iso'), Buffer.alloc(4 * 1024 * 1024, 1))
    writeFileSync(join(other, 'win.iso'), 'small')
    const [a, b] = await Promise.all([importIso(join(src, 'win.iso'), isos, 'copy'), importIso(join(other, 'win.iso'), isos, 'copy')])
    expect(a).toBe(join(isos, 'win.iso'))
    expect(b).toBe(join(isos, 'win (2).iso'))
    expect(readFileSync(b, 'utf8')).toBe('small')
  })
})
