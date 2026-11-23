import { ipcMain, shell, type BrowserWindow } from 'electron'
import { readdirSync, readFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { join } from 'node:path'
import { defaultConfig, type VmConfig } from '@shared/config'
import type { HostInfo, PowerAction, SaveStateResult } from '@shared/ipc'
import { agentHibernate } from './agent'
import { detectAccel, findQemu, qemuVersion, type DataPaths } from './paths'
import { deleteConfig, listConfigs, saveConfig } from './store'
import { QUICKSAVE, VmRunner } from './vmRunner'

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

  ipcMain.handle('start', async (_e, name: string, opts?: { resume?: boolean }) => {
    const cfg = byName(name)
    if (opts?.resume === true && (await runner.hasSaveState(cfg))) {
      await runner.start(cfg, { loadState: QUICKSAVE })
      // a save state is used once. Loading it again later would throw away
      // everything done on the disk since, so drop it as soon as it's loaded.
      await runner.deleteSnapshotLive(name, QUICKSAVE).catch(() => undefined)
      return
    }
    await runner.start(cfg)
  })

  ipcMain.handle('saveState', async (_e, name: string): Promise<SaveStateResult> => {
    const accel = runner.accelOf(name)
    if (!accel) throw new Error(`${name} is not running`)
    if (accel === 'tcg') {
      await runner.saveAndQuit(name)
      return { method: 'savevm' }
    }
    // QEMU can't write WHPX memory to disk, so the guest saves itself: it hibernates
    // to its own swap, powers off, and the next normal boot picks up where it was.
    await agentHibernate(runner.agentPortOf(name))
    runner.markExpectedExit(name)
    return { method: 'hibernate' }
  })

  ipcMain.handle('hasSaveState', (_e, name: string) => runner.hasSaveState(byName(name)))

  ipcMain.handle('discardSaveState', async (_e, name: string) => {
    const cfg = byName(name)
    if (runner.isRunning(name)) throw new Error('Turn the VM off first')
    if (await runner.hasSaveState(cfg)) await runner.img().snapshotDelete(cfg.diskPath, QUICKSAVE)
  })

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
