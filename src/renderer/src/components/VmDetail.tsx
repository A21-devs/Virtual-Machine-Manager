import { useEffect, useState } from 'react'
import { validateVmName, type VmConfig } from '@shared/config'
import type { HostInfo, VmStatus, VmUsage } from '@shared/ipc'
import OsMark from './OsMark'
import Hardware from './Hardware'
import LogView from './LogView'
import Preview from './Preview'
import { forwardError } from './PortForwards'
import Profiles from './Profiles'
import Sparkline from './Sparkline'
import type { PushToast } from './Toasts'
import { errText, fileName, gb, statusLabel } from '../util'

interface Props {
  vm: VmConfig
  isDraft: boolean
  status: VmStatus
  host: HostInfo | null
  /** CPU and memory samples of this VM, oldest first, empty while it's off */
  usage: VmUsage[]
  onSave: (cfg: VmConfig, previousName?: string) => void
  onCancelDraft: () => void
  onDelete: (name: string) => void
  onDirtyChange: (dirty: boolean) => void
  toast: PushToast
  onNeedsSetup: (reason: string) => void
}

type Tab = 'summary' | 'hardware' | 'profiles' | 'log'
const TABS: { id: Tab; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'hardware', label: 'Hardware' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'log', label: 'Log' }
]

export default function VmDetail(props: Props) {
  const { vm, isDraft, status, host, onSave, onCancelDraft, onDelete, onDirtyChange } = props
  const [tab, setTab] = useState<Tab>(isDraft ? 'hardware' : 'summary')
  const [form, setForm] = useState<VmConfig>(vm)
  useEffect(() => setForm(vm), [vm])

  const dirty = isDraft || JSON.stringify(form) !== JSON.stringify(vm)
  const nameError = validateVmName(form.name)
  const diskError =
    !Number.isInteger(form.diskSizeGB) || form.diskSizeGB < 5 || form.diskSizeGB > 4096 ? 'Pick a whole number from 5 to 4096 GB' : null
  const forwardsInvalid = form.forwards.some((_f, i) => forwardError(form.forwards, i) !== null)

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
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'tab active' : 'tab'}
            disabled={isDraft && t.id !== 'hardware'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'hardware' && dirty && !isDraft && <span className="tab-dot" aria-label="unsaved changes" />}
          </button>
        ))}
      </nav>

      <div className="tab-body">
        {tab === 'summary' && <Summary vm={vm} status={status} host={host} usage={props.usage} />}
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
            forwardsInvalid={forwardsInvalid}
            onSave={() => onSave(form, vm.name)}
            onRevert={() => (isDraft ? onCancelDraft() : setForm(vm))}
            onDelete={() => onDelete(vm.name)}
          />
        )}
        {tab === 'profiles' && <Profiles vm={vm} status={status} toast={props.toast} onNeedsSetup={props.onNeedsSetup} />}
        {tab === 'log' && <LogView name={vm.name} status={status} />}
      </div>
    </main>
  )
}

function Summary({ vm, status, host, usage }: { vm: VmConfig; status: VmStatus; host: HostInfo | null; usage: VmUsage[] }) {
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
    ...(vm.network === 'nat' && vm.forwards.length
      ? [['Forwards', vm.forwards.map((f) => `${f.proto.toUpperCase()} ${f.hostPort} → ${f.guestPort}`).join(', ')] as [string, React.ReactNode]]
      : []),
    ['Display', `${vm.video.toUpperCase()} · ${vm.display === 'auto' ? 'SDL' : vm.display.toUpperCase()} window`],
    ['Firmware', vm.firmware === 'uefi' ? 'UEFI' : 'BIOS'],
    ['Startup', vm.autostart ? `Starts with the app${vm.resumeLast ? ', resumes saved state' : ''}` : 'Manual'],
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
      <div className="summary-left">
        <Preview name={vm.name} status={status} />
        {status !== 'off' && <Usage usage={usage} ramMB={vm.ramMB} />}
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

/** Live CPU and memory of the QEMU process, with the last two minutes as sparklines. */
function Usage({ usage, ramMB }: { usage: VmUsage[]; ramMB: number }) {
  const last = usage[usage.length - 1]
  // QEMU itself needs some memory on top of the guest's
  const memMax = Math.max(ramMB + 512, ...usage.map((u) => u.memMB))
  return (
    <div className="usage" role="group" aria-label="Resource use">
      <div className="usage-item">
        <span className="muted">CPU</span>
        <strong>{last ? `${last.cpuPercent.toFixed(0)}%` : '…'}</strong>
        <Sparkline values={usage.map((u) => u.cpuPercent)} max={100} label="CPU use over the last two minutes" />
      </div>
      <div className="usage-item">
        <span className="muted">Memory</span>
        <strong>{last ? gb(last.memMB) : '…'}</strong>
        <Sparkline values={usage.map((u) => u.memMB)} max={memMax} label="Memory use over the last two minutes" />
      </div>
    </div>
  )
}
