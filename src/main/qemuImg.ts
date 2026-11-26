import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface ImgSnapshot {
  name: string
  vmStateSize: number
  dateSec: number
}

export interface ImgInfo {
  virtualBytes: number
  actualBytes: number
  backingFile: string | null
  snapshots: ImgSnapshot[]
}

/** Parses `qemu-img info --output=json`. Exported for tests. */
export function parseInfo(json: string): ImgInfo {
  const j = JSON.parse(json) as Record<string, unknown>
  const snaps = Array.isArray(j.snapshots) ? (j.snapshots as Record<string, unknown>[]) : []
  const backing = j['full-backing-filename'] ?? j['backing-filename']
  return {
    virtualBytes: Number(j['virtual-size'] ?? 0),
    actualBytes: Number(j['actual-size'] ?? 0),
    backingFile: typeof backing === 'string' ? backing : null,
    snapshots: snaps.map((s) => ({ name: String(s.name), vmStateSize: Number(s['vm-state-size'] ?? 0), dateSec: Number(s['date-sec'] ?? 0) }))
  }
}

/** Thin wrapper around qemu-img.exe. All calls use an argument array, never a shell. */
export class QemuImg {
  constructor(private readonly exe: string) {}

  private async call(args: string[], timeout = 120_000): Promise<string> {
    try {
      const { stdout } = await run(this.exe, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 })
      return stdout
    } catch (e) {
      const err = e as { stderr?: string; message: string }
      throw new Error((err.stderr || err.message).trim().replace(/^.*qemu-img(\.exe)?: /i, ''))
    }
  }

  /** -U lets this read a disk that a running VM has open. */
  async info(disk: string): Promise<ImgInfo> {
    return parseInfo(await this.call(['info', '-U', '--output=json', disk], 30_000))
  }

  create(disk: string, sizeGB: number): Promise<string> {
    return this.call(['create', '-f', 'qcow2', disk, `${sizeGB}G`])
  }

  /** A new disk that only stores changes on top of `backing`, which it reads but never writes. */
  createOverlay(disk: string, backing: string): Promise<string> {
    return this.call(['create', '-f', 'qcow2', '-b', backing, '-F', 'qcow2', disk])
  }

  /** Full copy. `-c` would compress but makes the guest slower later, so it's left off. */
  convert(src: string, dest: string): Promise<string> {
    return this.call(['convert', '-O', 'qcow2', src, dest], 60 * 60_000)
  }

  snapshotCreate =(disk: string, tag: string) => this.call(['snapshot', '-c', tag, disk])
  snapshotApply = (disk: string, tag: string) => this.call(['snapshot', '-a', tag, disk])
  snapshotDelete = (disk: string, tag: string) => this.call(['snapshot', '-d', tag, disk])
}
