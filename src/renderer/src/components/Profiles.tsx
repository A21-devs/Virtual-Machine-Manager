import { useCallback, useEffect, useState } from 'react'
import { Camera, Pencil, Play, Trash2 } from 'lucide-react'
import type { VmConfig } from '@shared/config'
import type { Profile, VmStatus } from '@shared/ipc'
import type { PushToast } from './Toasts'
import { errText, when } from '../util'

interface Props {
  vm: VmConfig
  status: VmStatus
  toast: PushToast
  /** the guest agent didn't answer, show the one-time setup */
  onNeedsSetup: (reason: string) => void
}

const KIND: Record<Profile['kind'], string> = {
  session: 'everything that was open',
  full: 'memory + disk',
  disk: 'disk only, boots fresh'
}

export default function Profiles({ vm, status, toast, onNeedsSetup }: Props) {
  const [list, setList] = useState<Profile[] | null>(null)
  const [label, setLabel] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const off = status === 'off'
  const canTake = status === 'running' && label.trim() !== '' && busy === null

  const load = useCallback(async () => {
    try {
      setList(await window.vmm.profiles(vm.name))
    } catch (e) {
      setList([])
      toast('error', 'Could not read profiles', errText(e))
    }
  }, [vm.name, toast])

  // saving and launching turn the VM off and on again, so reload on every status change
  useEffect(() => {
    load()
  }, [load, status])

  async function act(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key)
    try {
      await fn()
      if (ok) toast('ok', ok)
    } catch (e) {
      const msg = errText(e)
      if (msg.startsWith('needs-guest-setup')) onNeedsSetup(msg.replace(/^needs-guest-setup:\s*/, ''))
      else toast('error', 'That did not work', msg)
    } finally {
      setBusy(null)
      load()
    }
  }

  const save = () => {
    const name = label.trim()
    act(
      'take',
      async () => {
        await window.vmm.takeProfile(vm.name, name, note)
        setLabel('')
        setNote('')
      },
      `Saved "${name}". ${vm.name} is coming back up.`
    )
  }

  function launch(p: Profile) {
    if (!off && !confirm(`${vm.name} is on. Turn it off and launch "${p.label}"? Anything not saved in a profile is lost.`)) return
    act(`l${p.tag}`, () => window.vmm.launchProfile(vm.name, p.tag, !off), `Launching "${p.label}"`)
  }

  const hint =
    status === 'running'
      ? `Saves everything that's open in ${vm.name}. It closes for a moment while it saves, then comes right back. Launch the profile any time to return to exactly this point.`
      : status === 'paused'
        ? `${vm.name} is paused. Resume it to save a profile, a paused guest can't save itself.`
        : `Power on ${vm.name} to save a profile of everything that's open in it.`

  return (
    <div className="profiles">
      <section className="panel">
        <h2>Save a profile</h2>
        <p className="muted">{hint}</p>
        <div className="profile-form">
          <input
            placeholder="Name, e.g. tools set up"
            aria-label="Profile name"
            value={label}
            maxLength={80}
            disabled={busy !== null}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !canTake) return
              // otherwise the same keypress clicks whatever a dialog opened by save() focuses
              e.preventDefault()
              save()
            }}
          />
          <input placeholder="Note (optional)" aria-label="Profile note" value={note} disabled={busy !== null} onChange={(e) => setNote(e.target.value)} />
          <button className="btn primary" disabled={!canTake} onClick={save}>
            <Camera size={14} /> {busy === 'take' ? 'Saving…' : 'Save profile'}
          </button>
        </div>
        {busy === 'take' && <p className="muted saving-note">{vm.name} is writing everything to its disk. This can take a minute with a lot of RAM.</p>}
      </section>

      <section>
        <h2 className="section-title">
          Profiles {list && list.length > 0 && <span className="count">{list.length}</span>}
        </h2>
        {list === null ? (
          <p className="muted">Loading…</p>
        ) : list.length === 0 ? (
          <p className="muted">No profiles yet.</p>
        ) : (
          <ul className="profile-list">
            {list.map((p) => (
              <li key={p.tag} className="profile-card">
                <Shot vm={vm.name} p={p} />
                <div className="profile-info">
                  {editing === p.tag ? (
                    <EditForm
                      p={p}
                      onCancel={() => setEditing(null)}
                      onSave={(l, n) =>
                        act('edit', async () => {
                          await window.vmm.editProfile(vm.name, p.tag, l, n)
                          setEditing(null)
                        })
                      }
                    />
                  ) : (
                    <>
                      <strong>{p.label}</strong>
                      <span className="muted">
                        {when(p.created)} · {KIND[p.kind]}
                      </span>
                      {p.note && <span className="profile-note">{p.note}</span>}
                    </>
                  )}
                </div>
                {editing !== p.tag && (
                  <div className="profile-actions">
                    <button
                      className="btn small primary"
                      disabled={busy !== null || status === 'starting'}
                      onClick={() => launch(p)}
                      title="Go back to this profile and start it"
                    >
                      <Play size={13} /> {busy === `l${p.tag}` ? 'Launching…' : 'Launch'}
                    </button>
                    <button className="icon-btn" aria-label={`Edit ${p.label}`} title="Rename or change the note" disabled={busy !== null} onClick={() => setEditing(p.tag)}>
                      <Pencil size={14} />
                    </button>
                    <button
                      className="icon-btn danger"
                      aria-label={`Delete ${p.label}`}
                      title="Delete"
                      disabled={busy !== null}
                      onClick={() => confirm(`Delete the profile "${p.label}"?`) && act(`d${p.tag}`, () => window.vmm.deleteProfile(vm.name, p.tag), 'Profile deleted')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Shot({ vm, p }: { vm: string; p: Profile }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!p.hasShot) return
    let alive = true
    window.vmm.profileShot(vm, p.tag).then(
      (s) => alive && setSrc(s),
      () => undefined // the card just says "No screenshot"
    )
    return () => {
      alive = false
    }
  }, [vm, p.tag, p.hasShot])
  return <div className="profile-shot">{src ? <img src={src} alt={`Screen of ${p.label}`} /> : <span>No screenshot</span>}</div>
}

function EditForm({ p, onSave, onCancel }: { p: Profile; onSave: (label: string, note: string) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(p.label)
  const [note, setNote] = useState(p.note)
  return (
    <div className="profile-edit">
      <input aria-label="Profile name" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} autoFocus />
      <input aria-label="Profile note" value={note} placeholder="Note" onChange={(e) => setNote(e.target.value)} />
      <div className="btn-row">
        <button className="btn small primary" disabled={!label.trim()} onClick={() => onSave(label, note)}>
          Save
        </button>
        <button className="btn small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
