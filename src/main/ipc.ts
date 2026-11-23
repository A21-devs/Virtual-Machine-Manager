import { ipcMain, shell, type BrowserWindow } from 'electron'
import { readdirSync, readFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { join } from 'node:path'
import { defaultConfig, type VmConfig } from '@shared/config'
import type { HostInfo, PowerAction, Profile, SaveStateResult, StartResult } from '@shared/ipc'
import { agentHibernate } from './agent'
import { GuestSetupServer } from './guestSetup'
import { detectAccel, findQemu, qemuVersion, type DataPaths } from './paths'
import { Profiles } from './profiles'
import { deleteConfig, listConfigs, saveConfig } from './store'
import { QUICKSAVE, VmRunner } from './vmRunner'

export function registerIpc(paths: DataPaths, getWindow: () => BrowserWindow | null): VmRunner {
  const runner = new VmRunner(paths, () => findQemu(paths))
  const guestSetup = new GuestSetupServer()
  const profiles = new Profiles(paths, runner)

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

  ipcMain.handle('save', (_e, cfg: VmConfig, previousName?: string) => {
    const saved = saveConfig(paths, cfg, previousName)
    // labels and screenshots are kept by VM name, so they have to move along
    if (previousName && previousName !== saved.name) {
      try {
        profiles.rename(previousName, saved.name)
      } catch (e) {
        // the config is already saved, a stuck screenshot folder shouldn't make that look failed
        console.warn(`could not move the profiles of ${previousName}:`, e)
      }
    }
    return saved
  })

  // a profile save leaves the VM off for a while before booting it again
  const notMidProfile = (name: string) => {
    if (profiles.isBusy(name)) throw new Error(`${name} is busy with a profile. Wait for it to finish.`)
  }

  ipcMain.handle('remove', (_e, name: string) => {
    notMidProfile(name)
    if (runner.state(name).status !== 'off') throw new Error('Turn the VM off before deleting it')
    deleteConfig(paths, name) // the disk file is kept on purpose
  })

  ipcMain.handle('start', async (_e, name: string, opts?: { resume?: boolean }): Promise<StartResult> => {
    notMidProfile(name)
    const cfg = byName(name)
    if (opts?.resume === true && (await runner.hasSaveState(cfg))) {
      await runner.start(cfg, { loadState: QUICKSAVE })
      // a save state is used once. Loading it again later would throw away
      // everything done on the disk since, so drop it as soon as it's loaded.
      try {
        await runner.deleteSnapshotLive(name, QUICKSAVE)
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e)
        return {
          resumed: true,
          warning: `The save state could not be removed after loading it (${why}). Discard it on the Summary tab once ${name} is off, otherwise the next Power on goes back to it and loses what you did since.`
        }
      }
      return { resumed: true }
    }
    await runner.start(cfg)
    return { resumed: false }
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
    try {
      await agentHibernate(runner.agentPortOf(name))
    } catch (e) {
      // most likely qemu-guest-agent isn't installed yet, the UI offers the one-time setup
      return { method: 'needs-setup', reason: e instanceof Error ? e.message : String(e) }
    }
    runner.markExpectedExit(name)
    return { method: 'hibernate' }
  })

  ipcMain.handle('guestSetupCommand', () => guestSetup.command())

  ipcMain.handle('hasSaveState', (_e, name: string) => runner.hasSaveState(byName(name)))

  ipcMain.handle('discardSaveState', async (_e, name: string) => {
    const cfg = byName(name)
    if (runner.isRunning(name)) throw new Error('Turn the VM off first')
    if (await runner.hasSaveState(cfg)) await runner.img().snapshotDelete(cfg.diskPath, QUICKSAVE)
  })

  ipcMain.handle('profiles', (_e, name: string) => profiles.list(byName(name)))
  ipcMain.handle('takeProfile', (_e, name: string, label: string, note: string): Promise<Profile> => profiles.take(byName(name), String(label), String(note ?? '')))
  ipcMain.handle('launchProfile', (_e, name: string, tag: string, force: boolean) => profiles.launch(byName(name), tag, force === true))
  ipcMain.handle('deleteProfile', (_e, name: string, tag: string) => profiles.remove(byName(name), tag))
  ipcMain.handle('editProfile', (_e, name: string, tag: string, label: string, note: string) =>
    profiles.edit(byName(name), tag, String(label), String(note ?? ''))
  )
  // byName makes sure the folder it reads from belongs to a real VM
  ipcMain.handle('profileShot', (_e, name: string, tag: string) => profiles.shot(byName(name).name, tag))

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
