import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { VmmApi } from '@shared/ipc'

const listen = <T>(channel: string, cb: (payload: T) => void) => {
  const handler = (_e: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.off(channel, handler)
  }
}

// the renderer only ever talks to the main process through this object
const api: VmmApi = {
  host: () => ipcRenderer.invoke('host'),
  list: () => ipcRenderer.invoke('list'),
  newConfig: () => ipcRenderer.invoke('newConfig'),
  save: (cfg, previousName) => ipcRenderer.invoke('save', cfg, previousName),
  remove: (name) => ipcRenderer.invoke('remove', name),
  start: (name, opts) => ipcRenderer.invoke('start', name, opts),
  autostart: () => ipcRenderer.invoke('autostart'),
  power: (name, action) => ipcRenderer.invoke('power', name, action),
  states: () => ipcRenderer.invoke('states'),
  saveState: (name) => ipcRenderer.invoke('saveState', name),
  hasSaveState: (name) => ipcRenderer.invoke('hasSaveState', name),
  discardSaveState: (name) => ipcRenderer.invoke('discardSaveState', name),
  guestSetupCommand: () => ipcRenderer.invoke('guestSetupCommand'),
  profiles: (name) => ipcRenderer.invoke('profiles', name),
  takeProfile: (name, label, note) => ipcRenderer.invoke('takeProfile', name, label, note),
  launchProfile: (name, tag, force) => ipcRenderer.invoke('launchProfile', name, tag, force),
  deleteProfile: (name, tag) => ipcRenderer.invoke('deleteProfile', name, tag),
  editProfile: (name, tag, label, note) => ipcRenderer.invoke('editProfile', name, tag, label, note),
  profileShot: (name, tag) => ipcRenderer.invoke('profileShot', name, tag),
  preview: (name) => ipcRenderer.invoke('preview', name),
  isPortFree: (port, proto) => ipcRenderer.invoke('isPortFree', port, proto),
  pathForFile: (file) => webUtils.getPathForFile(file),
  importIso: (path, mode) => ipcRenderer.invoke('importIso', path, mode),
  clone: (name, newName, linked) => ipcRenderer.invoke('clone', name, newName, linked),
  openDataFolder: () => ipcRenderer.invoke('openDataFolder'),
  openLog: (name) => ipcRenderer.invoke('openLog', name),
  readLog: (name) => ipcRenderer.invoke('readLog', name),
  onState: (cb) => listen('vm:state', cb),
  onCrash: (cb) => listen('vm:crash', cb),
  onUsage: (cb) => listen('vm:usage', cb),
  onHostChanged: (cb) => listen('host:changed', () => cb())
}

contextBridge.exposeInMainWorld('vmm', api)
