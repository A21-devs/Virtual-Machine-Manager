import { useEffect, useState } from 'react'
import { validateVmName, type VmConfig } from '@shared/config'
import type { HostInfo, VmStatus } from '@shared/ipc'
import OsMark from './OsMark'
import Hardware from './Hardware'
import LogView from './LogView'
import { errText, fileName, gb, statusLabel } from '../util'

interface Props {
  vm: VmConfig
  isDraft: boolean
  status: VmStatus
  host: HostInfo | null
  onSave: (cfg: VmConfig, previousName?: string) => void
  onCancelDraft: () => void
  onDelete: (name: string) => void
  onDirtyChange: (dirty: boolean) => void
}

type Tab = 'summary' | 'hardware' | 'log'

export default function VmDetail({ vm, isDraft, status, host, onSave, onCancelDraft, onDelete, onDirtyChange }: Props) {
  const [tab, setTab] = useState<Tab>(isDraft ? 'hardware' : 'summary')
  const [form, setForm] = useState<VmConfig>(vm)
  useEffect(() => setForm(vm), [vm])

  const dirty = isDraft || JSON.stringify(form) !== JSON.stringify(vm)
  const nameError = validateVmName(form.name)
  const diskError =
    !Number.isInteger(form.diskSizeGB) || form.diskSizeGB < 5 || form.diskSizeGB > 4096 ? 'Pick a whole number from 5 to 4096 GB' : null

  // the toolbar lives in App, it needs to know when Power on would ignore unsaved edits
  useEffect(() => {
    onDirtyChange(!isDraft && dirty)
    return () => onDirtyChange(false) // switching VMs throws the edits away
  }, [dirty, isDraft, onDirtyChange])

  return (
    <main className="detail">
      <div className="detail-head">
        <OsMark os={form.os} large />
        <div className="detail-title">
          <h1>{form.name || 'Untitled'}</h1>
          <span className={`state-text ${status}`}>{isDraft ? 'Not created yet' : statusLabel[status]}</span>
        </div>
      </div>

      <nav className="tabs" role="tablist">
        {(['summary', 'hardware', 'log'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'tab active' : 'tab'}
            disabled={isDraft && t !== 'hardware'}
            onClick={() => setTab(t)}
          >
            {t === 'summary' ? 'Summary' : t === 'hardware' ? 'Hardware' : 'Log'}
            {t === 'hardware' && dirty && !isDraft && <span className="tab-dot" aria-label="unsaved changes" />}
          </button>
        ))}
      </nav>

      <div className="tab-body">
        {tab === 'summary' && <Summary vm={vm} status={status} host={host} />}
        {tab === 'hardware' && (
          <Hardware
            form={form}
            setForm={setForm}
            host={host}
            locked={status !== 'off'}
            isDraft={isDraft}
            dirty={dirty}
            nameError={nameError}
            diskError={diskError}
            onSave={() => onSave(form, vm.name)}
            onRevert={() => (isDraft ? onCancelDraft() : setForm(vm))}
            onDelete={() => onDelete(vm.name)}
          />
        )}
        {tab === 'log' && <LogView name={vm.name} status={status} />}
      </div>
    </main>
  )
}

function Summary({ vm, status, host }: { vm: VmConfig; status: VmStatus; host: HostInfo | null }) {
  const [hasSave, setHasSave] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [discardError, setDiscardError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    // checked again on every status change: saving turns the VM off, Power on uses the save up
    window.vmm.hasSaveState(vm.name).then((h) => live && setHasSave(h), () => live && setHasSave(false))
    return () => {
      live = false
    }
  }, [vm.name, status])

  const discard = async () => {
    if (!confirm(`Throw away the save state of ${vm.name}? It will start fresh next time.`)) return
    setDiscarding(true)
    setDiscardError(null)
    try {
      await window.vmm.discardSaveState(vm.name)
      setHasSave(false)
    } catch (e) {
      setDiscardError(errText(e))
    } finally {
      setDiscarding(false)
    }
  }

  const isoMissing = Boolean(vm.iso) && host !== null && !host.isos.includes(vm.iso)
  const rows: [string, React.ReactNode][] = [
    ['Guest OS', vm.os === 'linux' ? 'Linux' : vm.os === 'windows' ? 'Windows' : 'Other'],
    ['Processors', `${vm.cpus} cores`],
    ['Memory', gb(vm.ramMB)],
    ['Hard disk', `${vm.diskSizeGB} GB · ${vm.diskBus.toUpperCase()}`],
    [
      'CD/DVD',
      vm.iso ? (
        <span className={isoMissing ? 'warn-text' : ''} title={vm.iso}>
          {fileName(vm.iso)}
          {isoMissing ? ' (file missing)' : vm.bootFromIso ? ' · boots first' : ''}
        </span>
      ) : (
        'Empty'
      )
    ],
    ['Network', vm.network === 'nat' ? `NAT · ${vm.nic}` : 'Disconnected'],
    ['Display', `${vm.video.toUpperCase()} · ${vm.display === 'auto' ? 'SDL' : vm.display.toUpperCase()} window`],
    ['Firmware', vm.firmware === 'uefi' ? 'UEFI' : 'BIOS'],
    ['Disk file', <span className="mono" title={vm.diskPath}>{vm.diskPath}</span>]
  ]
  if (hasSave) {
    rows.splice(1, 0, [
      'Save state',
      <span className="save-row">
        Power on resumes it
        <button className="btn small danger-ghost" disabled={status !== 'off' || discarding} onClick={discard} title={status !== 'off' ? 'Turn the VM off first' : undefined}>
          Discard
        </button>
        {discardError && <span className="warn-text">{discardError}</span>}
      </span>
    ])
  }
  return (
    <div className="summary">
      <div className={`screen ${status}`}>
        <span>{status === 'off' ? 'Powered off' : status === 'paused' ? 'Suspended' : 'Running in its own window'}</span>
      </div>
      <table className="props">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
