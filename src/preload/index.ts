import { contextBridge } from 'electron'

// the renderer only ever talks to the main process through this object
const api = {
  platform: process.platform
}

contextBridge.exposeInMainWorld('vmm', api)

export type VmmApi = typeof api
