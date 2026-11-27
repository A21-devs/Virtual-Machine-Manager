import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'node:path'
import type { AppSettings } from '@shared/ipc'
import { registerIpc, type Backend } from './ipc'
import { dataPaths, type DataPaths } from './paths'
import { defaultSettings, loadSettings } from './settings'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: '#1b1b1c',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1b1b1c', symbolColor: '#ececee', height: 32 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  mainWindow = win
  win.on('closed', () => (mainWindow = null))
  win.once('ready-to-show', () => win.show())

  // open external links in the real browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

let backend: Backend | null = null
let settings: AppSettings

app.whenReady().then(() => {
  const settingsDir = app.getPath('userData')
  settings = loadSettings(settingsDir)
  let paths: DataPaths
  let fallbackFrom: string | null = null
  try {
    paths = dataPaths(settings.dataRoot)
  } catch {
    // the saved folder is gone or can't be written (unplugged drive, no permission). Start with
    // the default one for this run instead of not starting at all. settings keeps the saved
    // folder, so saving something else in Settings doesn't overwrite it with the fallback.
    fallbackFrom = settings.dataRoot
    paths = dataPaths(defaultSettings().dataRoot)
  }
  backend = registerIpc({
    paths,
    getWindow: () => mainWindow,
    settingsDir,
    getSettings: () => settings,
    setSettings: (s) => (settings = s),
    relaunch: () => {
      app.relaunch()
      app.quit() // before-quit still stops the folder watcher and the usage sampler
    }
  })
  app.on('before-quit', () => {
    backend?.dispose()
    backend?.runner.killAll()
  })
  // auto-start runs when the renderer asks for it (the 'autostart' IPC), once it can show errors
  createWindow()
  if (fallbackFrom) {
    const msg = `Your data folder ${fallbackFrom} can't be used right now, so the app is using ${paths.root} for this run. Plug the drive in and restart, or pick another folder in Settings.`
    void (mainWindow ? dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Data folder not found', message: msg }) : dialog.showMessageBox({ type: 'warning', message: msg }))
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
