import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@shared/config'
import type { StartResult } from '@shared/ipc'
import { runAutostart } from '../src/main/autostart'

const DISKS = 'C:\\VMs\\disks'
const vm = (name: string, autostart: boolean, resumeLast = false) => ({ ...defaultConfig(name, DISKS), autostart, resumeLast })

describe('runAutostart', () => {
  it('starts only the marked VMs, in order, passing resumeLast through', async () => {
    const calls: [string, boolean][] = []
    const issues = await runAutostart([vm('a', true, true), vm('b', false), vm('c', true)], async (name, resume) => {
      calls.push([name, resume])
      return { resumed: resume }
    })
    expect(calls).toEqual([
      ['a', true],
      ['c', false]
    ])
    expect(issues).toEqual([])
  })

  it('keeps going after a failure and reports errors and warnings', async () => {
    const started: string[] = []
    const issues = await runAutostart([vm('a', true), vm('b', true, true), vm('c', true)], async (name): Promise<StartResult> => {
      if (name === 'a') throw new Error('QEMU not found')
      started.push(name)
      return name === 'b' ? { resumed: true, warning: 'could not remove the save state' } : { resumed: false }
    })
    expect(started).toEqual(['b', 'c'])
    expect(issues).toEqual([
      { name: 'a', error: 'QEMU not found' },
      { name: 'b', warning: 'could not remove the save state' }
    ])
  })
})
