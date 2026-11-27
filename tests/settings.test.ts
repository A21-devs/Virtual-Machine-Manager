import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { findQemu, dataPaths } from '../src/main/paths'
import { loadSettings, normalizeSettings, saveSettings } from '../src/main/settings'

const dir = mkdtempSync(join(tmpdir(), 'vmm-settings-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const defaultRoot = join(homedir(), 'VMs')

describe('settings', () => {
  it('falls back to the defaults for missing, wrong or relative values', () => {
    expect(normalizeSettings(null)).toEqual({ dataRoot: defaultRoot, qemuPath: '' })
    expect(normalizeSettings({ dataRoot: '  ', qemuPath: 5 })).toEqual({ dataRoot: defaultRoot, qemuPath: '' })
    // a relative path would depend on whatever folder the app happened to start in
    expect(normalizeSettings({ dataRoot: 'VMs', qemuPath: 'qemu\qemu-system-x86_64.exe' })).toEqual({ dataRoot: defaultRoot, qemuPath: '' })
  })

  it('keeps good values, trimmed', () => {
    const root = join(dir, 'D VMs')
    expect(normalizeSettings({ dataRoot: ` ${root} `, qemuPath: join(dir, 'qemu-system-x86_64.exe'), extra: 1 })).toEqual({
      dataRoot: root,
      qemuPath: join(dir, 'qemu-system-x86_64.exe')
    })
  })

  it('saves and loads, and survives a broken file', () => {
    const s = { dataRoot: join(dir, 'elsewhere'), qemuPath: '' }
    saveSettings(dir, s)
    expect(loadSettings(dir, {})).toEqual(s)
    writeFileSync(join(dir, 'settings.json'), '{ not json')
    expect(loadSettings(dir, {})).toEqual({ dataRoot: defaultRoot, qemuPath: '' })
  })

  it('lets VMM_DATA_ROOT win over the file without changing the file', () => {
    saveSettings(dir, { dataRoot: join(dir, 'real'), qemuPath: '' })
    expect(loadSettings(dir, { VMM_DATA_ROOT: join(dir, 'temp') }).dataRoot).toBe(join(dir, 'temp'))
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).dataRoot).toBe(join(dir, 'real'))
  })
})

describe('findQemu', () => {
  const paths = dataPaths(join(dir, 'data'))

  it('uses the path from settings when it exists, and nothing else when it does not', () => {
    const exe = join(dir, 'qemu-system-x86_64.exe')
    writeFileSync(exe, '')
    expect(findQemu(paths, exe)).toBe(exe)
    // a set path that's gone means QEMU is missing, not "quietly use another one"
    expect(findQemu(paths, join(dir, 'gone', 'qemu-system-x86_64.exe'))).toBeNull()
  })
})
