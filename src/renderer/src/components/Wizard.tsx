import { useMemo, useState } from 'react'
import { Disc, FolderOpen } from 'lucide-react'
import { validateVmName, type VmConfig } from '@shared/config'
import type { HostInfo } from '@shared/ipc'
import { PRESETS, guessPreset, presetById, suggestName } from '@shared/presets'
import Modal from './Modal'
import { fileName, gb } from '../util'

interface Props {
  host: HostInfo | null
  taken: string[]
  initialIso?: string
  onCreate: (cfg: VmConfig) => Promise<void>
  onClose: () => void
}

const STEPS = ['Installer', 'Type', 'Name'] as const

export default function Wizard({ host, taken, initialIso = '', onCreate, onClose }: Props) {
  const [step, setStep] = useState(0)
  const [iso, setIso] = useState(initialIso)
  const [presetId, setPresetId] = useState(() => guessPreset(initialIso).id)
  const [name, setName] = useState(() => suggestName(initialIso, taken))
  const [touchedName, setTouchedName] = useState(false)
  const [busy, setBusy] = useState(false)

  const isos = useMemo(() => {
    const list = [...(host?.isos ?? [])]
    if (iso && !list.includes(iso)) list.push(iso)
    return list
  }, [host, iso])

  const preset = presetById(presetId)
  const nameError = validateVmName(name) ?? (taken.some((t) => t.toLowerCase() === name.trim().toLowerCase()) ? 'A VM with this name already exists' : null)

  function chooseIso(path: string) {
    setIso(path)
    setPresetId(guessPreset(path).id)
    if (!touchedName) setName(suggestName(path, taken))
  }

  async function browse() {
    const p = await window.vmm.pickFile(iso, 'iso')
    if (p) chooseIso(p)
  }

  async function create() {
    if (busy || nameError) return
    setBusy(true)
    try {
      const base = await window.vmm.newConfig()
      // the disk is named after the VM, not the "New VM n" placeholder newConfig picked
      const disk = base.diskPath.replace(/[^\\/]+$/, `${name.trim()}.qcow2`)
      await onCreate({ ...base, ...preset.values, name: name.trim(), iso, bootFromIso: Boolean(iso), diskPath: disk })
    } finally {
      setBusy(false)
    }
  }

  const footer = (
    <>
      <span className="muted">
        Step {step + 1} of {STEPS.length}
      </span>
      <span className="spacer" />
      {step > 0 && (
        <button className="btn" onClick={() => setStep(step - 1)}>
          Back
        </button>
      )}
      {step < STEPS.length - 1 ? (
        <button className="btn primary" onClick={() => setStep(step + 1)}>
          Next
        </button>
      ) : (
        <button className="btn primary" disabled={Boolean(nameError) || busy} onClick={create}>
          Create
        </button>
      )}
    </>
  )

  return (
    <Modal title="New virtual machine" onClose={onClose} footer={footer} width={540}>
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'current' : i < step ? 'done' : ''}>
            {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="wiz-body">
          <p className="muted">Pick the installer ISO. You can also drop an .iso file onto the window.</p>
          <div className="pick-list" role="listbox" aria-label="Installer ISOs">
            <button role="option" aria-selected={iso === ''} className={`pick ${iso === '' ? 'active' : ''}`} onClick={() => chooseIso('')}>
              <Disc size={15} /> <span>No installer (empty CD drive)</span>
            </button>
            {isos.map((p) => (
              <button key={p} role="option" aria-selected={iso === p} className={`pick ${iso === p ? 'active' : ''}`} onClick={() => chooseIso(p)} title={p}>
                <Disc size={15} /> <span>{fileName(p)}</span>
              </button>
            ))}
          </div>
          <button className="btn small" onClick={browse}>
            <FolderOpen size={13} /> Browse for an ISO…
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="wiz-body">
          <p className="muted">{iso ? `Guessed from ${fileName(iso)}. ` : ''}This only sets starting hardware, all of it can be changed later.</p>
          <div className="preset-grid" role="radiogroup" aria-label="Operating system">
            {PRESETS.map((p) => (
              <button key={p.id} role="radio" aria-checked={p.id === presetId} className={`preset ${p.id === presetId ? 'active' : ''}`} onClick={() => setPresetId(p.id)}>
                <strong>{p.label}</strong>
                <span className="muted">
                  {p.values.cpus} cores · {gb(p.values.ramMB)} · {p.values.diskSizeGB} GB
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="wiz-body">
          <label className="field">
            <span>Name</span>
            <input
              value={name}
              aria-invalid={Boolean(nameError)}
              onChange={(e) => {
                setTouchedName(true)
                setName(e.target.value)
              }}
              onKeyDown={(e) => e.key === 'Enter' && create()}
            />
            {nameError && <span className="prop-error">{nameError}</span>}
          </label>
          <table className="props compact">
            <tbody>
              <tr>
                <th scope="row">Installer</th>
                <td>{iso ? fileName(iso) : 'None'}</td>
              </tr>
              <tr>
                <th scope="row">Type</th>
                <td>{preset.label}</td>
              </tr>
              <tr>
                <th scope="row">Hardware</th>
                <td>
                  {preset.values.cpus} cores, {gb(preset.values.ramMB)} RAM, {preset.values.diskSizeGB} GB disk ({preset.values.diskBus.toUpperCase()}), {preset.values.firmware.toUpperCase()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
