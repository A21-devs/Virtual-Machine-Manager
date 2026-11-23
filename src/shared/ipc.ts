import type { VmConfig } from './config'

export type VmStatus = 'off' | 'starting' | 'running' | 'paused'

export interface VmRuntimeState {
  name: string
  status: VmStatus
  pid: number | null
  startedAt: number | null
}

export interface HostInfo {
  qemuPath: string | null
  qemuVersion: string | null
  accel: 'whpx' | 'tcg' | null
  dataRoot: string
  isos: string[]
  cpuCount: number
  totalRamMB: number
}

export type PowerAction = 'pause' | 'resume' | 'reset' | 'shutdown' | 'kill'

/** Everything the renderer can call. Implemented in main/ipc.ts, exposed in preload. */
export interface VmmApi {
  host(): Promise<HostInfo>
  list(): Promise<VmConfig[]>
  newConfig(): Promise<VmConfig>
  save(cfg: VmConfig, previousName?: string): Promise<VmConfig>
  remove(name: string): Promise<void>
  start(name: string): Promise<void>
  power(name: string, action: PowerAction): Promise<void>
  states(): Promise<VmRuntimeState[]>
  openDataFolder(): Promise<void>
  openLog(name: string): Promise<void>
  readLog(name: string): Promise<string>
  onState(cb: (s: VmRuntimeState) => void): () => void
  onCrash(cb: (c: { name: string; message: string }) => void): () => void
}
