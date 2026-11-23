import { useEffect, useState } from 'react'
import { validateVmName, type VmConfig } from '@shared/config'
import type { HostInfo, VmStatus } from '@shared/ipc'
import OsMark from './OsMark'
import Hardware from './Hardware'
import LogView from './LogView'
import { fileName, gb, statusLabel } from '../util'

interface Props {
  vm: VmConfig
  isDraft: boolean
  status: VmStatus
  host: HostInfo | null
  onSave: (cfg: VmConfig, previousName?: string) => void
  onCancelDraft: () => void
  onDelete: (name: string) => void
}

type Tab = 'summary' | 'hardware' | 'log'

export default function VmDetail({ vm, isDraft, status, host, onSave, onCancelDraft, onDelete }: Props) {
  const [tab, setTab] = useState<Tab>(isDraft ? 'hardware' : 'summary')
  const [form, setForm] = useState<VmConfig>(vm)
  useEffect(() => setForm(vm), [vm])

  const dirty = isDraft || JSON.stringify(form) !== JSON.stringify(vm)
  const nameError = validateVmName(form.name)

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
