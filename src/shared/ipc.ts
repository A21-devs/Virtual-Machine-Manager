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

/** What a running VM's QEMU process uses. cpuPercent is of the whole PC (all cores = 100) */
export interface VmUsage {
  cpuPercent: number
  memMB: number
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

/** A VM auto-start has to tell the user about. error: it didn't start. warning: it started, but read this. */
export interface AutostartIssue {
  name: string
  error?: string
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

/** App-wide settings, from settings.json in Electron's userData folder */
export interface AppSettings {
  /** where vms, disks, ISOs, logs and profiles live */
  dataRoot: string
  /** full path to qemu-system-x86_64.exe, '' = find it automatically */
  qemuPath: string
}

/** What qemu-img says about a VM's disk file. exists is false before the VM's first boot. */
export interface DiskInfo {
  exists: boolean
  /** the size the guest sees */
  virtualBytes: number
  /** what the file takes on the host's drive */
  actualBytes: number
  /** set for a linked clone: the shared read-only disk it is built on */
  backingFile: string | null
  /** profiles plus the save state, if any. Resize and compact refuse while there are some */
  snapshotCount: number
}

/** Everything the renderer can call. Implemented in main/ipc.ts, exposed in preload. */
export interface VmmApi {
  host(): Promise<HostInfo>
  list(): Promise<VmConfig[]>
  /** defaults for a new VM. With a name, the disk file is named after it and never one that already exists */
  newConfig(name?: string): Promise<VmConfig>
  save(cfg: VmConfig, previousName?: string): Promise<VmConfig>
  remove(name: string): Promise<void>
  /** resume: load the save state if the disk has one */
  start(name: string, opts?: { resume?: boolean }): Promise<StartResult>
  /**
   * Starts the VMs marked for auto-start. Called by the UI once it's listening for
   * events. Only the first call per app run does anything, later ones return [].
   */
  autostart(): Promise<AutostartIssue[]>
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
  /** the VM's current screen as a PNG data: URL, null when it's off or QEMU isn't answering yet */
  preview(name: string): Promise<string | null>
  /** false when something on this PC already has 127.0.0.1:port bound for that protocol */
  isPortFree(port: number, proto: 'tcp' | 'udp'): Promise<boolean>
  /** the screenshot as a data: URL */
  profileShot(name: string, tag: string): Promise<string | null>
  /** the command to type into a Linux guest once so Save state (hibernate) works there */
  guestSetupCommand(): Promise<string>
  /** the full path of a file dropped on the window */
  pathForFile(file: File): string
  /** reference: keep it where it is. copy: copy it into the ISOs folder. Returns the path to use */
  importIso(path: string, mode: 'copy' | 'reference'): Promise<string>
  /** copies a powered-off VM under a new name and returns the new VM's config. linked = share the disk as a base */
  clone(name: string, newName: string, linked: boolean): Promise<VmConfig>
  diskInfo(name: string): Promise<DiskInfo>
  /** grows the disk to sizeGB (never shrinks) and saves that size in the config. VM must be off */
  resizeDisk(name: string, sizeGB: number): Promise<void>
  /** rewrites the disk to give back space the guest freed. Returns the file size before and after */
  compactDisk(name: string): Promise<{ before: number; after: number }>
  /** Windows file picker for an .iso (starts in the ISOs folder) or QEMU's .exe. null when cancelled */
  pickFile(current: string, kind: 'iso' | 'qemu'): Promise<string | null>
  /** folder picker, null when cancelled */
  pickFolder(current: string): Promise<string | null>
  settings(): Promise<AppSettings>
  /** a bad QEMU path is refused. restartNeeded: the data folder changed, it's used after relaunch() */
  saveSettings(s: AppSettings): Promise<{ restartNeeded: boolean }>
  /** the QEMU version at that path, null if it isn't a QEMU that runs */
  checkQemu(path: string): Promise<string | null>
  /** restarts the app. Refused while VMs are running */
  relaunch(): Promise<void>
  openDataFolder(): Promise<void>
  openLog(name: string): Promise<void>
  readLog(name: string): Promise<string>
  onState(cb: (s: VmRuntimeState) => void): () => void
  onCrash(cb: (c: { name: string; message: string }) => void): () => void
  /** every 2 s while VMs run: CPU and memory of each running VM, by name */
  onUsage(cb: (u: Record<string, VmUsage>) => void): () => void
  /** something in host() changed, for now the list of ISOs */
  onHostChanged(cb: () => void): () => void
}
