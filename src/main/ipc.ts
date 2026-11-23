import { ipcMain, shell, type BrowserWindow } from 'electron'
import { readdirSync, readFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { join } from 'node:path'
import { defaultConfig, type VmConfig } from '@shared/config'
import type { HostInfo, PowerAction } from '@shared/ipc'
import { detectAccel, findQemu, qemuVersion, type DataPaths } from './paths'
import { deleteConfig, listConfigs, saveConfig } from './store'
import { VmRunner } from './vmRunner'

export function registerIpc(paths: DataPaths, getWindow: () => BrowserWindow | null): VmRunner {
  const runner = new VmRunner(paths, () => findQemu(paths))

  const send = (channel: string, payload: unknown) => getWindow()?.webContents.send(channel, payload)
  runner.on('state', (s) => send('vm:state', s))
  runner.on('crash', (c) => send('vm:crash', c))

  const byName = (name: string): VmConfig => {
    const cfg = listConfigs(paths).find((c) => c.name === name)
    if (!cfg) throw new Error(`No VM called "${name}"`)
    return cfg
  }

  ipcMain.handle('host', async (): Promise<HostInfo> => {
    const qemuPath = findQemu(paths)
    let isos: string[] = []
    try {
      isos = readdirSync(paths.isos)
        .filter((f) => f.toLowerCase().endsWith('.iso'))
        .map((f) => join(paths.isos, f))
    } catch {
      /* folder missing */
    }
    return {
      qemuPath,
      qemuVersion: qemuPath ? await qemuVersion(qemuPath) : null,
      accel: qemuPath ? await detectAccel(qemuPath) : null,
      dataRoot: paths.root,
      isos,
      cpuCount: cpus().length,
      totalRamMB: Math.floor(totalmem() / 1024 / 1024)
    }
  })

  ipcMain.handle('list', () => listConfigs(paths))

  ipcMain.handle('newConfig', () => {
    const taken = new Set(listConfigs(paths).map((c) => c.name.toLowerCase()))
    let i = 1
    while (taken.has(`new vm ${i}`)) i++
    return defaultConfig(`New VM ${i}`, paths.disks)
  })

  ipcMain.handle('save', (_e, cfg: VmConfig, previousName?: string) => saveConfig(paths, cfg, previousName))

  ipcMain.handle('remove', (_e, name: string) => {
    if (runner.state(name).status !== 'off') throw new Error('Turn the VM off before deleting it')
    deleteConfig(paths, name) // the disk file is kept on purpose
  })

  ipcMain.handle('start', (_e, name: string) => runner.start(byName(name)))

  ipcMain.handle('power', async (_e, name: string, action: PowerAction) => {
    if (action === 'kill') return runner.kill(name)
    await runner[action](name)
  })

  ipcMain.handle('states', () => runner.allStates())
  ipcMain.handle('openDataFolder', () => shell.openPath(paths.root))
  ipcMain.handle('openLog', (_e, name: string) => shell.openPath(join(paths.logs, `${name}.log`)))
  ipcMain.handle('readLog', (_e, name: string) => {
    try {
      const text = readFileSync(join(paths.logs, `${name}.log`), 'utf8')
      return text.length > 200_000 ? text.slice(-200_000) : text // only the tail of huge logs
    } catch {
      return ''
    }
  })

  return runner
}
