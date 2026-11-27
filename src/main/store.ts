import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeConfig, validateVmName, type VmConfig } from '@shared/config'
import type { DataPaths } from './paths'

const configFile = (paths: DataPaths, name: string) => join(paths.vms, `${name}.json`)

/**
 * A disk file for a new VM called name that nothing uses yet: not a file in the disks folder
 * (Remove keeps the disk, and a new VM must not boot an old one) and not the disk of another VM
 * that hasn't been started yet. Adds " (2)", " (3)", ... until it is free.
 */
export function freeDiskPath(diskDir: string, name: string, used: string[], exists: (p: string) => boolean = existsSync): string {
  const taken = new Set(used.map((p) => p.toLowerCase()))
  for (let i = 1; ; i++) {
    const p = join(diskDir, i === 1 ? `${name}.qcow2` : `${name} (${i}).qcow2`)
    if (!taken.has(p.toLowerCase()) && !exists(p)) return p
  }
}

export function listConfigs(paths: DataPaths): VmConfig[] {
  return readdirSync(paths.vms)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .flatMap((f) => {
      try {
        // the legacy app wrote UTF-8 with a BOM, strip it before parsing
        const text = readFileSync(join(paths.vms, f), 'utf8').replace(/^﻿/, '')
        return [normalizeConfig(JSON.parse(text), paths.disks)]
      } catch {
        return [] // one broken file shouldn't hide every other VM
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function saveConfig(paths: DataPaths, cfg: VmConfig, previousName?: string): VmConfig {
  const err = validateVmName(cfg.name)
  if (err) throw new Error(err)
  const clean = normalizeConfig(cfg, paths.disks)
  const target = configFile(paths, clean.name)
  if (previousName && previousName !== clean.name && existsSync(target)) {
    throw new Error(`A VM called "${clean.name}" already exists`)
  }
  // write to a temp file first so a crash never leaves a half-written config
  const tmp = `${target}.tmp`
  writeFileSync(tmp, JSON.stringify(clean, null, 2), 'utf8')
  renameSync(tmp, target)
  if (previousName && previousName !== clean.name) {
    const old = configFile(paths, previousName)
    if (existsSync(old)) unlinkSync(old)
  }
  return clean
}

export function deleteConfig(paths: DataPaths, name: string): void {
  const f = configFile(paths, name)
  if (existsSync(f)) unlinkSync(f)
}
