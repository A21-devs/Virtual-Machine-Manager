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

/**
 * savevm: RAM written into the qcow2 (TCG only). hibernate: the guest saves itself and powers off (WHPX).
 * needs-setup: the guest agent didn't answer, the guest needs the one-time setup first.
 */
export type SaveStateResult = { method: 'savevm' } | { method: 'hibernate' } | { method: 'needs-setup'; reason: string }

/** resumed: a save state was loaded. warning: something the user has to know about (it's still running) */
export interface StartResult {
  resumed: boolean
  warning?: string
}

/**
 * A named save point ("profile"), stored as an internal qcow2 snapshot.
 * session = taken while running: the guest hibernated first, so launching it brings back
 *           everything that was open.
 * full = has QEMU memory in it (savevm, only possible without WHPX).
 * disk = plain disk snapshot, launching it cold boots that disk.
 */
export interface Profile {
  tag: string
  label: string
  note: string
  created: number
  kind: 'disk' | 'full' | 'session'
  hasShot: boolean
}

/** Everything the renderer can call. Implemented in main/ipc.ts, exposed in preload. */
export interface VmmApi {
  host(): Promise<HostInfo>
  list(): Promise<VmConfig[]>
  newConfig(): Promise<VmConfig>
  save(cfg: VmConfig, previousName?: string): Promise<VmConfig>
  remove(name: string): Promise<void>
  /** resume: load the save state if the disk has one */
  start(name: string, opts?: { resume?: boolean }): Promise<StartResult>
  power(name: string, action: PowerAction): Promise<void>
  states(): Promise<VmRuntimeState[]>
  saveState(name: string): Promise<SaveStateResult>
  hasSaveState(name: string): Promise<boolean>
  discardSaveState(name: string): Promise<void>
  /** named save points, newest first */
  profiles(name: string): Promise<Profile[]>
  /** saves the running session. Errors starting with needs-guest-setup mean the guest agent is missing */
  takeProfile(name: string, label: string, note: string): Promise<Profile>
  /** rolls back to the profile and boots it. force = turn the VM off first if it's running */
  launchProfile(name: string, tag: string, force: boolean): Promise<void>
  deleteProfile(name: string, tag: string): Promise<void>
  editProfile(name: string, tag: string, label: string, note: string): Promise<void>
  /** the screenshot as a data: URL */
  profileShot(name: string, tag: string): Promise<string | null>
  /** the command to type into a Linux guest once so Save state (hibernate) works there */
  guestSetupCommand(): Promise<string>
  openDataFolder(): Promise<void>
  openLog(name: string): Promise<void>
  readLog(name: string): Promise<string>
  onState(cb: (s: VmRuntimeState) => void): () => void
  onCrash(cb: (c: { name: string; message: string }) => void): () => void
}
