import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import type { AppSettings } from '@shared/ipc'
import { registerIpc, type Backend } from './ipc'
import { dataPaths } from './paths'
import { loadSettings } from './settings'

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
  backend = registerIpc({
    paths: dataPaths(settings.dataRoot),
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
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
