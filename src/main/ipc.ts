import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { defaultConfig, validPort, type VmConfig } from '@shared/config'
import type { AppSettings, AutostartIssue, DiskInfo, HostInfo, PowerAction, Profile, SaveStateResult, StartResult } from '@shared/ipc'
import { agentHibernate } from './agent'
import { cloneVm, compactDisk, resizeDisk } from './disks'
import { runAutostart } from './autostart'
import { GuestSetupServer } from './guestSetup'
import { importIso, listIsos, watchFolder } from './isos'
import { detectAccel, findQemu, qemuVersion, type DataPaths } from './paths'
import { Profiles } from './profiles'
import { checkDataRoot, loadSettings, normalizeSettings, saveSettings } from './settings'
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

/** What the IPC layer needs from the app around it. */
export interface IpcContext {
  paths: DataPaths
  getWindow: () => BrowserWindow | null
  /** Electron's userData folder, where settings.json lives */
  settingsDir: string
  getSettings: () => AppSettings
  setSettings: (s: AppSettings) => void
  /** restarts the app, used after the data folder changes */
  relaunch: () => void
}

export function registerIpc(ctx: IpcContext): Backend {
  const { paths, getWindow } = ctx
  // read on every call, so a QEMU path saved in Settings is used from the next start on
  const qemu = () => findQemu(paths, ctx.getSettings().qemuPath)
  const runner = new VmRunner(paths, qemu)
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
    const qemuPath = qemu()
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

  ipcMain.handle('pickFile', async (_e, current: string, kind: 'iso' | 'qemu') => {
    if (kind !== 'iso' && kind !== 'qemu') throw new Error(`Unknown file kind: ${String(kind)}`)
    const win = getWindow()
    const filters = kind === 'iso' ? [{ name: 'Disc images', extensions: ['iso'] }] : [{ name: 'QEMU', extensions: ['exe'] }]
    const opts = { defaultPath: current || (kind === 'iso' ? paths.isos : undefined), properties: ['openFile' as const], filters }
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

  // a full clone or a compact works on the disk for minutes, nothing may start or change the VM
  // meanwhile. VM name -> what is going on, for the error message
  const diskWork = new Map<string, string>()
  const withDiskWork = async <T>(name: string, what: string, fn: () => Promise<T>): Promise<T> => {
    notBusy(name)
    diskWork.set(name, what)
    try {
      return await fn()
    } finally {
      diskWork.delete(name)
    }
  }

  // a profile save leaves the VM off for a while before booting it again, disk work needs it off throughout
  const notBusy = (name: string) => {
    const work = diskWork.get(name)
    if (work) throw new Error(`${name} is ${work}. Wait for it to finish.`)
    if (profiles.isBusy(name)) throw new Error(`${name} is busy with a profile. Wait for it to finish.`)
  }

  ipcMain.handle('clone', async (_e, name: string, newName: unknown, linked: unknown) => {
    if (typeof newName !== 'string') throw new Error('Name is required')
    return withDiskWork(name, 'being cloned', async () => {
      const copy = await cloneVm(runner, paths, byName(name), newName, linked === true, listConfigs(paths))
      return saveConfig(paths, copy)
    })
  })

  // ---- disk tools ----
  ipcMain.handle('diskInfo', async (_e, name: string): Promise<DiskInfo> => {
    const cfg = byName(name)
    if (!existsSync(cfg.diskPath)) return { exists: false, virtualBytes: 0, actualBytes: 0, backingFile: null, snapshotCount: 0 }
    // -U reads it even while the VM runs
    const info = await runner.img().info(cfg.diskPath)
    return { exists: true, virtualBytes: info.virtualBytes, actualBytes: info.actualBytes, backingFile: info.backingFile, snapshotCount: info.snapshots.length }
  })
  ipcMain.handle('resizeDisk', (_e, name: string, sizeGB: unknown) =>
    withDiskWork(name, 'getting a bigger disk', async () => {
      const cfg = byName(name)
      const size = Number(sizeGB)
      await resizeDisk(runner, cfg, size)
      // keep the config's size in step, it's what the Hardware tab and the next create use
      saveConfig(paths, { ...cfg, diskSizeGB: size }, cfg.name)
    })
  )
  ipcMain.handle('compactDisk', (_e, name: string) => withDiskWork(name, 'having its disk compacted', () => compactDisk(runner, byName(name))))

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

  // ---- settings ----
  ipcMain.handle('settings', () => ctx.getSettings())
  ipcMain.handle('saveSettings', async (_e, s: AppSettings) => {
    const clean = normalizeSettings(s)
    if (clean.qemuPath && !(await checkQemu(clean.qemuPath))) throw new Error("That file doesn't run as QEMU. Pick qemu-system-x86_64.exe from your QEMU folder.")
    const envRoot = process.env.VMM_DATA_ROOT
    // only when the user picked another folder. Compared with the saved one, not paths.root: after
    // a startup fallback those differ, and the unplugged folder must not block saving the rest
    if (!envRoot && clean.dataRoot.toLowerCase() !== ctx.getSettings().dataRoot.toLowerCase()) {
      // a folder the app can't write would stop it from starting after the restart
      const problem = checkDataRoot(clean.dataRoot)
      if (problem) throw new Error(problem)
    }
    // with VMM_DATA_ROOT set (tests, dev runs) the data folder can't be changed here, and the
    // real settings file keeps its own data folder instead of getting the temp one written in
    const saved = saveSettings(ctx.settingsDir, envRoot ? { ...clean, dataRoot: loadSettings(ctx.settingsDir, {}).dataRoot } : clean)
    ctx.setSettings(envRoot ? { ...saved, dataRoot: envRoot } : saved)
    // the data folder is read once at startup, the QEMU path applies from the next start on
    return { restartNeeded: !envRoot && saved.dataRoot.toLowerCase() !== paths.root.toLowerCase() }
  })
  ipcMain.handle('checkQemu', (_e, path: unknown) => (typeof path === 'string' ? checkQemu(path) : null))
  ipcMain.handle('pickFolder', async (_e, current: string) => {
    const win = getWindow()
    const opts = { defaultPath: current || undefined, properties: ['openDirectory' as const, 'createDirectory' as const] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0] ?? null
  })
  ipcMain.handle('relaunch', () => {
    // a restart would kill running VMs, so it's refused instead
    const running = listConfigs(paths).filter((c) => runner.isRunning(c.name)).map((c) => c.name)
    if (running.length) throw new Error(`Power off ${running.join(', ')} first, a restart would cut ${running.length === 1 ? 'it' : 'them'} off.`)
    ctx.relaunch()
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

/** The QEMU version if path is a qemu-system-x86_64.exe that runs, otherwise null. */
async function checkQemu(path: string): Promise<string | null> {
  if (!isAbsolute(path) || !/qemu-system-x86_64(\.exe)?$/i.test(path) || !existsSync(path)) return null
  return qemuVersion(path)
}
