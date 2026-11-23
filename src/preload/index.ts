import { contextBridge, ipcRenderer } from 'electron'
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
  start: (name) => ipcRenderer.invoke('start', name),
  power: (name, action) => ipcRenderer.invoke('power', name, action),
  states: () => ipcRenderer.invoke('states'),
  openDataFolder: () => ipcRenderer.invoke('openDataFolder'),
  openLog: (name) => ipcRenderer.invoke('openLog', name),
  readLog: (name) => ipcRenderer.invoke('readLog', name),
  onState: (cb) => listen('vm:state', cb),
  onCrash: (cb) => listen('vm:crash', cb)
}

contextBridge.exposeInMainWorld('vmm', api)
