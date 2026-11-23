import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dataPaths } from '../src/main/paths'
import { Profiles } from '../src/main/profiles'
import type { VmRunner } from '../src/main/vmRunner'

// rename and shot only touch the profiles folder, so no runner is needed
let root = ''
const setup = () => {
  root = mkdtempSync(join(tmpdir(), 'vmm-prof-unit-'))
  const paths = dataPaths(root)
  return { paths, profiles: new Profiles(paths, {} as VmRunner) }
}
const put = (dir: string, meta: object, shots: string[]) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'profiles.json'), JSON.stringify(meta))
  for (const s of shots) writeFileSync(join(dir, `${s}.png`), s)
}

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('profile folders', () => {
  it('moves the folder when the VM is renamed', () => {
    const { paths, profiles } = setup()
    put(join(paths.profiles, 'a'), { p1: { label: 'one', note: '', created: 1 } }, ['p1'])
    profiles.rename('a', 'b')
    expect(existsSync(join(paths.profiles, 'a'))).toBe(false)
    expect(profiles.shot('b', 'p1')).toMatch(/^data:image\/png;base64,/)
  })

  it('merges into a folder left behind by a deleted VM', () => {
    const { paths, profiles } = setup()
    put(join(paths.profiles, 'old'), { p1: { label: 'mine', note: '', created: 1 } }, ['p1'])
    put(join(paths.profiles, 'new'), { p0: { label: 'stale', note: '', created: 0 }, p1: { label: 'clash', note: '', created: 0 } }, ['p0'])
    profiles.rename('old', 'new')
    const meta = JSON.parse(readFileSync(join(paths.profiles, 'new', 'profiles.json'), 'utf8'))
    expect(meta.p1.label).toBe('mine')
    expect(meta.p0.label).toBe('stale')
    expect(profiles.shot('new', 'p1')).not.toBeNull()
    expect(existsSync(join(paths.profiles, 'old'))).toBe(false)
  })

  it('refuses tags that would leave the profiles folder', () => {
    const { profiles } = setup()
    expect(() => profiles.shot('a', '../x')).toThrow(/Bad profile id/)
    expect(() => profiles.shot('a', '..\\x')).toThrow(/Bad profile id/)
    expect(() => profiles.shot('a', '')).toThrow(/Bad profile id/)
    expect(profiles.shot('a', 'p1')).toBeNull()
  })
})
