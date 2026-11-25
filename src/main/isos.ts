import { existsSync, readdirSync, statSync, watch } from 'node:fs'
import { copyFile, rename, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { VmConfig } from '@shared/config'

/**
 * Adds an ISO the user dropped on the window. reference: use it where it is.
 * copy: copy it into the ISOs folder. Returns the path the VM should use.
 */
export async function importIso(src: string, isosDir: string, mode: 'copy' | 'reference'): Promise<string> {
  if (typeof src !== 'string' || !/\.iso$/i.test(src)) throw new Error('Only .iso files can be added')
  let size: number
  try {
    const st = statSync(src)
    if (!st.isFile()) throw new Error()
    size = st.size
  } catch {
    throw new Error(`${src} does not exist`)
  }
  if (mode === 'reference') return src
  if (mode !== 'copy') throw new Error(`Unknown import mode: ${String(mode)}`)

  // same name and size counts as the same ISO dropped twice and is reused,
  // a different file with the same name gets a number
  const stem = basename(src, extname(src))
  let target = join(isosDir, basename(src))
  for (let i = 2; ; i++) {
    const running = copying.get(target.toLowerCase())
    if (running) {
      // the same file dropped again while its copy is still going: wait for that one
      if (running.src.toLowerCase() === src.toLowerCase()) return running.done
    } else if (!existsSync(target)) {
      break
    } else if (target.toLowerCase() === src.toLowerCase() || statSync(target).size === size) {
      return target
    }
    target = join(isosDir, `${stem} (${i}).iso`)
  }
  const key = target.toLowerCase()
  const done = copyInto(src, target).finally(() => copying.delete(key))
  copying.set(key, { src, done })
  return done
}

/** copies running right now, by lowercased target path */
const copying = new Map<string, { src: string; done: Promise<string> }>()

async function copyInto(src: string, target: string): Promise<string> {
  // copy under a name the ISO list ignores, so a half-copied file never shows up as bootable
  const part = `${target}.part`
  try {
    await copyFile(src, part)
    await rename(part, target)
  } catch (e) {
    await rm(part, { force: true })
    throw e
  }
  return target
}

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
      // On Windows, deleting the watched folder doesn't emit 'error', it fires 'rename'
      // for the folder in a tight loop. Stop there and report the (now empty) list once.
      if (!existsSync(dir)) {
        w.close()
        onChange()
        return
      }
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
