import { useCallback, useEffect, useState } from 'react'
import type { VmConfig } from '@shared/config'
import type { DiskInfo, VmStatus } from '@shared/ipc'
import type { PushToast } from './Toasts'
import { bytes, errText, fileName } from '../util'

interface Props {
  vm: VmConfig
  status: VmStatus
  /** the Hardware form has unsaved edits. Growing saves the config, which would throw them away */
  dirty: boolean
  toast: PushToast
  /** the config changed on disk (new size), the library should reload it */
  onChanged: () => void
}

const GB = 1024 ** 3
const MAX_GB = 16384

/** Size of the disk file, plus Grow and Compact. Shown on the Hardware tab once the disk exists. */
export default function DiskTools({ vm, status, dirty, toast, onChanged }: Props) {
  const [info, setInfo] = useState<DiskInfo | null>(null)
  const [grow, setGrow] = useState(vm.diskSizeGB)
  const [busy, setBusy] = useState<'grow' | 'compact' | null>(null)
  const off = status === 'off'

  const load = useCallback(() => {
    window.vmm
      .diskInfo(vm.name)
      .then((i) => {
        setInfo(i)
        if (i.exists) setGrow(Math.ceil(i.virtualBytes / GB))
      })
      .catch(() => setInfo(null))
  }, [vm.name])

  // the file changes size while the VM runs, so read it again on every power change
  useEffect(load, [load, status])

  if (!info) return null
  if (!info.exists) return <span className="prop-hint">The disk file is made the first time the VM is powered on.</span>

  const current = Math.ceil(info.virtualBytes / GB)
  const canGrow = Number.isInteger(grow) && grow > current && grow <= MAX_GB

  async function run(kind: 'grow' | 'compact', fn: () => Promise<[string, string?]>) {
    setBusy(kind)
    try {
      const [title, body] = await fn()
      toast('ok', title, body)
      load()
      onChanged()
    } catch (e) {
      toast('error', kind === 'grow' ? 'Could not grow the disk' : 'Could not compact the disk', errText(e))
    } finally {
      setBusy(null)
    }
  }

  const blocked = !off ? 'Power off to grow or compact the disk.' : dirty ? 'Save or revert your hardware changes first.' : null

  return (
    <div className="disk-tools">
      <div className="disk-usage">
        <div className="bar" role="img" aria-label={`${bytes(info.actualBytes)} used on this PC, up to ${current} GB`}>
          <span style={{ width: `${Math.min(100, (info.actualBytes / Math.max(1, info.virtualBytes)) * 100)}%` }} />
        </div>
        <span className="muted">
          {bytes(info.actualBytes)} on this PC · up to {current} GB
          {info.snapshotCount > 0 && ` · ${info.snapshotCount} snapshot${info.snapshotCount === 1 ? '' : 's'}`}
          {info.backingFile && ` · linked to ${fileName(info.backingFile)}`}
        </span>
      </div>
      <div className="btn-row">
        <div className="with-unit">
          <input
            type="number"
            aria-label="New disk size"
            min={current}
            max={MAX_GB}
            value={Number.isNaN(grow) ? '' : grow}
            disabled={Boolean(blocked) || busy !== null}
            onChange={(e) => setGrow(e.target.value === '' ? Number.NaN : Number(e.target.value))}
          />
          <span>GB</span>
        </div>
        <button
          className="btn small"
          disabled={Boolean(blocked) || busy !== null || !canGrow}
          onClick={() =>
            run('grow', async () => {
              await window.vmm.resizeDisk(vm.name, grow)
              return [`Disk grown to ${grow} GB`, 'Extend the partition inside the guest to use the new space.']
            })
          }
        >
          {busy === 'grow' ? 'Growing…' : 'Grow disk'}
        </button>
        <button
          className="btn small"
          disabled={Boolean(blocked) || busy !== null}
          title="Rewrites the disk file to give back space the guest has freed"
          onClick={() =>
            run('compact', async () => {
              const r = await window.vmm.compactDisk(vm.name)
              return [`Compacted ${vm.name}`, `${bytes(r.before)} before, ${bytes(r.after)} now.`]
            })
          }
        >
          {busy === 'compact' ? 'Compacting…' : 'Compact'}
        </button>
      </div>
      {blocked && <span className="prop-hint">{blocked}</span>}
    </div>
  )
}
