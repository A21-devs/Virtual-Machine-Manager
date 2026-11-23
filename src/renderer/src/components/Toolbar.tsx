import { Pause, Play, Plus, Power, RotateCcw, Square } from 'lucide-react'
import type { VmConfig } from '@shared/config'
import type { PowerAction, VmStatus } from '@shared/ipc'

interface Props {
  vm: VmConfig | null
  status: VmStatus
  busy: boolean
  onNew: () => void
  onStart: () => void
  onPower: (a: PowerAction) => void
}

const ICON = 16

export default function Toolbar({ vm, status, busy, onNew, onStart, onPower }: Props) {
  const off = status === 'off'
  const live = status === 'running' || status === 'paused'
  return (
    <div className="toolbar" role="toolbar" aria-label="Virtual machine actions">
      <button className="tb-btn" onClick={onNew}>
        <Plus size={ICON} /> New
      </button>
      <span className="tb-sep" />
      {off || !vm ? (
        <button className="tb-btn run" disabled={!vm || busy} onClick={onStart}>
          <Play size={ICON} /> Power on
        </button>
      ) : status === 'paused' ? (
        <button className="tb-btn run" disabled={busy} onClick={() => onPower('resume')}>
          <Play size={ICON} /> Resume
        </button>
      ) : (
        <button className="tb-btn" disabled={busy || status === 'starting'} onClick={() => onPower('pause')}>
          <Pause size={ICON} /> Suspend
        </button>
      )}
      <button className="tb-btn" disabled={!live || busy} onClick={() => onPower('reset')}>
        <RotateCcw size={ICON} /> Restart
      </button>
      <button className="tb-btn" disabled={!live || busy} onClick={() => onPower('shutdown')} title="Asks the guest OS to shut down">
        <Power size={ICON} /> Shut down
      </button>
      <button className="tb-btn danger" disabled={off || !vm} onClick={() => onPower('kill')} title="Turns the VM off immediately, unsaved work in the guest is lost">
        <Square size={ICON} /> Force off
      </button>
    </div>
  )
}
