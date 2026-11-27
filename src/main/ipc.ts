import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { join } from 'node:path'
import { defaultConfig, validPort, type VmConfig } from '@shared/config'
import type { AutostartIssue, HostInfo, PowerAction, Profile, SaveStateResult, StartResult } from '@shared/ipc'
import { agentHibernate } from './agent'
import { cloneVm } from './disks'
import { runAutostart } from './autostart'
import { GuestSetupServer } from './guestSetup'
import { importIso, listIsos, watchFolder } from './isos'
import { detectAccel, findQemu, qemuVersion, type DataPaths } from './paths'
import { Profiles } from './profiles'
import { deleteConfig, freeDiskPath, listConfigs, saveConfig } from './store'
import { UsageSampler } from './usage'
import { QUICKSAVE, VmRunner, isPortFree } from './vmRunner'

/** What the rest of the main process needs from the IPC layer. */
export interface Backend {
  runner: VmRunner
  configs: () => VmConfig[]
  /** Same as the renderer's Power on. With resume, a quick save state is loaded if there is one. */
  startVm: (name: string, resume: boolean) => Promise<StartResult>
  /** stops background work (ISO folder watcher, usage sampler) before the app quits */
  dispose: () => void
}

export function registerIpc(paths: DataPaths, getWindow: () => BrowserWindow | null): Backend {
  const runner = new VmRunner(paths, () => findQemu(paths))
  const guestSetup = new GuestSetupServer()
  const profiles = new Profiles(paths, runner)

  const send = (channel: string, payload?: unknown) => getWindow()?.webContents.send(channel, payload)
  runner.on('state', (s) => send('vm:state', s))
  runner.on('crash', (c) => send('vm:crash', c))

  // new or removed ISOs show up without restarting the app
  const stopIsoWatch = watchFolder(paths.isos, () => send('host:changed'))

  // CPU and memory of each running VM, every 2 s. Idle while nothing runs.
  const usage = new UsageSampler(() => runner.pids(), (u) => send('vm:usage', u))
  usage.start()

  const byName = (name: string): VmConfig => {
    const cfg = listConfigs(paths).find((c) => c.name === name)
    if (!cfg) throw new Error(`No VM called "${name}"`)
    return cfg
  }

  ipcMain.handle('host', async (): Promise<HostInfo> => {
    const qemuPath = findQemu(paths)
    const isos = listIsos(paths.isos, listConfigs(paths))
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

  // an .iso dropped on the window: used where it is, or copied into the ISOs folder
  ipcMain.handle('importIso', (_e, path: string, mode: 'copy' | 'reference') => importIso(path, paths.isos, mode))

  ipcMain.handle('list', () => listConfigs(paths))

  ipcMain.handle('pickFile', async (_e, current: string, kind: 'iso') => {
    if (kind !== 'iso') throw new Error(`Unknown file kind: ${String(kind)}`)
    const win = getWindow()
    const opts = { defaultPath: current || paths.isos, properties: ['openFile' as const], filters: [{ name: 'Disc images', extensions: ['iso'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0] ?? null
  })

  ipcMain.handle('newConfig', (_e, name?: string) => {
    const all = listConfigs(paths)
    let n = typeof name === 'string' ? name.trim() : ''
    if (!n) {
      const taken = new Set(all.map((c) => c.name.toLowerCase()))
      let i = 1
      while (taken.has(`new vm ${i}`)) i++
      n = `New VM ${i}`
    }
    const cfg = defaultConfig(n, paths.disks)
    return { ...cfg, diskPath: freeDiskPath(paths.disks, n, all.map((c) => c.diskPath)) }
  })

  ipcMain.handle('save', (_e, cfg: VmConfig, previousName?: string) => {
    notBusy(previousName ?? cfg.name)
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

  // a full clone reads the disk for minutes, nothing may start or change the VM meanwhile
  const cloning = new Set<string>()

  // a profile save leaves the VM off for a while before booting it again, and a clone needs it off throughout
  const notBusy = (name: string) => {
    if (cloning.has(name)) throw new Error(`${name} is being cloned. Wait for it to finish.`)
    if (profiles.isBusy(name)) throw new Error(`${name} is busy with a profile. Wait for it to finish.`)
  }

  ipcMain.handle('clone', async (_e, name: string, newName: unknown, linked: unknown) => {
    notBusy(name)
    if (typeof newName !== 'string') throw new Error('Name is required')
    cloning.add(name)
    try {
      const copy = await cloneVm(runner, paths, byName(name), newName, linked === true, listConfigs(paths))
      return saveConfig(paths, copy)
    } finally {
      cloning.delete(name)
    }
  })

  ipcMain.handle('remove', (_e, name: string) => {
    notBusy(name)
    if (runner.state(name).status !== 'off') throw new Error('Turn the VM off before deleting it')
    deleteConfig(paths, name) // the disk file is kept on purpose
  })

  const startVm = async (name: string, resume: boolean): Promise<StartResult> => {
    notBusy(name)
    const cfg = byName(name)
    if (resume && (await runner.hasSaveState(cfg))) {
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
  }

  ipcMain.handle('start', (_e, name: string, opts?: { resume?: boolean }) => startVm(name, opts?.resume === true))

  // The renderer asks for this once its listeners are up, so a VM that fails right away
  // still gets a toast. A reload of the window must not start everything a second time.
  let autostarted = false
  ipcMain.handle('autostart', (): Promise<AutostartIssue[]> => {
    if (autostarted) return Promise.resolve([])
    autostarted = true
    return runAutostart(listConfigs(paths), startVm)
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
    notBusy(name)
    const cfg = byName(name)
    if (runner.isRunning(name)) throw new Error('Turn the VM off first')
    if (await runner.hasSaveState(cfg)) await runner.img().snapshotDelete(cfg.diskPath, QUICKSAVE)
  })

  ipcMain.handle('profiles', (_e, name: string) => profiles.list(byName(name)))
  ipcMain.handle('takeProfile', (_e, name: string, label: string, note: string): Promise<Profile> => profiles.take(byName(name), String(label), String(note ?? '')))
  ipcMain.handle('launchProfile', (_e, name: string, tag: string, force: boolean) => {
    notBusy(name)
    return profiles.launch(byName(name), tag, force === true)
  })
  ipcMain.handle('deleteProfile', (_e, name: string, tag: string) => {
    notBusy(name)
    return profiles.remove(byName(name), tag)
  })
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

  // the Summary tab's live screen
  ipcMain.handle('preview', async (_e, name: string): Promise<string | null> => {
    const png = await runner.screenPng(name)
    return png ? `data:image/png;base64,${png.toString('base64')}` : null
  })
  // the port forward editor warns about host ports something else already has
  ipcMain.handle('isPortFree', (_e, port: unknown, proto: unknown) =>
    typeof port === 'number' && validPort(port) ? isPortFree(port, proto === 'udp' ? 'udp' : 'tcp') : false
  )
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

  return {
    runner,
    configs: () => listConfigs(paths),
    startVm,
    dispose: () => {
      stopIsoWatch()
      usage.stop()
    }
  }
}
