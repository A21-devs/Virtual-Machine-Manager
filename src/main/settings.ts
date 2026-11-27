import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { AppSettings } from '@shared/ipc'

/** Kept in Electron's userData folder, not in the data folder, since it says where that is. */
const FILE = 'settings.json'

export const defaultSettings = (): AppSettings => ({
  dataRoot: join(homedir(), 'VMs'),
  qemuPath: ''
})

/** Anything missing or wrong falls back to the default. Paths must be absolute. */
export function normalizeSettings(raw: unknown): AppSettings {
  const d = defaultSettings()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  // resolve drops a trailing backslash and .. parts, so the same folder always compares equal
  const path = (v: unknown) => (typeof v === 'string' && isAbsolute(v.trim()) ? resolve(v.trim()) : '')
  return {
    dataRoot: path(r.dataRoot) || d.dataRoot,
    qemuPath: path(r.qemuPath)
  }
}

/** VMM_DATA_ROOT wins over the file, so tests and dev runs never touch the real VMs folder. */
export function loadSettings(dir: string, env: NodeJS.ProcessEnv = process.env): AppSettings {
  const file = join(dir, FILE)
  let s = defaultSettings()
  if (existsSync(file)) {
    try {
      s = normalizeSettings(JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')))
    } catch {
      // a broken file shouldn't stop the app, it gets rewritten on the next save
    }
  }
  if (env.VMM_DATA_ROOT) s = { ...s, dataRoot: env.VMM_DATA_ROOT }
  return s
}

/** Writes to a temp file first so a crash can't leave half a settings file. */
export function saveSettings(dir: string, s: AppSettings): AppSettings {
  const clean = normalizeSettings(s)
  const file = join(dir, FILE)
  writeFileSync(`${file}.tmp`, JSON.stringify(clean, null, 2), 'utf8')
  renameSync(`${file}.tmp`, file)
  return clean
}

/**
 * Makes sure the app can use root as its data folder: creates it if needed and writes a
 * test file. Returns why it can't, or null when it's fine.
 */
export function checkDataRoot(root: string): string | null {
  try {
    mkdirSync(root, { recursive: true })
    const probe = join(root, `.vmm-write-test-${process.pid}`)
    writeFileSync(probe, '')
    rmSync(probe, { force: true })
    return null
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES') return `Windows doesn't allow writing to ${root}. Pick a folder in your user folder or on another drive.`
    if (code === 'ENOENT') return `${root} can't be reached. Is the drive plugged in?`
    return `Can't use ${root}: ${e instanceof Error ? e.message : String(e)}`
  }
}
