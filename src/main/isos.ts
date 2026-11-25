import { existsSync, readdirSync, watch } from 'node:fs'
import { join } from 'node:path'
import type { VmConfig } from '@shared/config'

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase() // Windows paths

/**
 * Every .iso in the ISOs folder, plus ISOs a VM points at somewhere else on disk,
 * as long as that file still exists. Missing ones are left out so the UI can flag them.
 */
export function listIsos(isosDir: string, configs: VmConfig[], exists: (p: string) => boolean = existsSync): string[] {
  let isos: string[] = []
  try {
    isos = readdirSync(isosDir)
      .filter((f) => f.toLowerCase().endsWith('.iso'))
      .map((f) => join(isosDir, f))
  } catch {
    /* folder missing */
  }
  for (const c of configs) {
    if (c.iso && !isos.some((i) => same(i, c.iso)) && exists(c.iso)) isos.push(c.iso)
  }
  return isos
}

/**
 * Calls onChange once things settle after files in dir are added, removed or renamed.
 * A big ISO being copied in fires lots of events, the delay folds them into one.
 * Returns a function that stops watching. If the folder can't be watched, nothing happens.
 */
export function watchFolder(dir: string, onChange: () => void, delayMs = 400): () => void {
  let timer: NodeJS.Timeout | null = null
  const stopTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  try {
    const w = watch(dir, () => {
      stopTimer()
      timer = setTimeout(() => {
        timer = null
        onChange()
      }, delayMs)
    })
    // without a listener, an error (say the folder gets deleted) would crash the main process
    w.on('error', () => {
      stopTimer()
      w.close()
    })
    return () => {
      stopTimer()
      w.close()
    }
  } catch {
    return () => undefined
  }
}
