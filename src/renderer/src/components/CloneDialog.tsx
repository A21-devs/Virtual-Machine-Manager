import { useState } from 'react'
import { validateVmName } from '@shared/config'
import Modal from './Modal'

interface Props {
  source: string
  taken: string[]
  /** resolves when the clone is done or has failed (the caller shows the result) */
  onClone: (name: string, linked: boolean) => Promise<void>
  onClose: () => void
}

/** First free "<name> copy", "<name> copy 2", ... Names are compared like Windows file names. */
export function suggestCloneName(source: string, taken: string[]): string {
  const used = (n: string) => taken.some((t) => t.toLowerCase() === n.toLowerCase())
  let n = `${source} copy`
  for (let i = 2; used(n); i++) n = `${source} copy ${i}`
  return n
}

export default function CloneDialog({ source, taken, onClone, onClose }: Props) {
  const [name, setName] = useState(() => suggestCloneName(source, taken))
  const [linked, setLinked] = useState(true)
  const [busy, setBusy] = useState(false)
  const error = validateVmName(name) ?? (taken.some((t) => t.toLowerCase() === name.trim().toLowerCase()) ? 'A VM with this name already exists' : null)

  async function go() {
    if (error || busy) return
    setBusy(true)
    try {
      await onClone(name.trim(), linked)
    } finally {
      setBusy(false)
    }
  }

  // closing mid-copy would hide that it's still running, so the dialog stays until it's done
  const close = () => !busy && onClose()

  return (
    <Modal
      title={`Clone ${source}`}
      onClose={close}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={Boolean(error) || busy} onClick={go}>
            {busy ? 'Cloning…' : 'Clone'}
          </button>
        </>
      }
    >
      <label className="field">
        <span>Name</span>
        <input value={name} disabled={busy} aria-invalid={Boolean(error)} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        {error && <span className="prop-error">{error}</span>}
      </label>
      <fieldset className="field" disabled={busy}>
        <legend>Type</legend>
        <label className="radio">
          <input type="radio" name="clone-kind" checked={linked} onChange={() => setLinked(true)} />
          <span>
            Linked clone
            <span className="prop-hint"> · seconds, almost no space. Both VMs share the current disk as a read-only base.</span>
          </span>
        </label>
        <label className="radio">
          <input type="radio" name="clone-kind" checked={!linked} onChange={() => setLinked(false)} />
          <span>
            Full clone
            <span className="prop-hint"> · an independent copy, takes as long and as much space as copying the disk.</span>
          </span>
        </label>
      </fieldset>
      <p className="muted">Profiles stay with {source}. Port forwards are copied to free host ports, and auto-start is off for the copy.</p>
    </Modal>
  )
}
