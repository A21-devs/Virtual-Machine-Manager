import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerIpc, type Backend } from './ipc'
import { dataPaths } from './paths'

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

app.whenReady().then(() => {
  backend = registerIpc(dataPaths(), () => mainWindow)
  app.on('before-quit', () => backend?.runner.killAll())
  createWindow()
  mainWindow?.webContents.once('did-finish-load', () => void autostart())
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

/** Starts the VMs marked "Start this VM automatically", one after another. */
async function autostart(): Promise<void> {
  if (!backend) return
  for (const cfg of backend.configs().filter((c) => c.autostart)) {
    try {
      await backend.startVm(cfg.name, cfg.resumeLast)
    } catch (e) {
      mainWindow?.webContents.send('vm:crash', { name: cfg.name, message: `Auto-start failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
