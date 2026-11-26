import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VmConfig } from '@shared/config'
import type { HostInfo, PowerAction, VmRuntimeState, VmStatus, VmUsage } from '@shared/ipc'
import Sidebar from './components/Sidebar'
import Toolbar from './components/Toolbar'
import VmDetail from './components/VmDetail'
import StatusBar from './components/StatusBar'
import Toasts, { useToasts } from './components/Toasts'
import GuestSetup from './components/GuestSetup'
import Modal from './components/Modal'
import CloneDialog from './components/CloneDialog'
import { errText, fileName } from './util'

const HISTORY = 60 // usage samples kept per VM, 2 s apart = two minutes

export default function App() {
  const [host, setHost] = useState<HostInfo | null>(null)
  const [vms, setVms] = useState<VmConfig[]>([])
  const [states, setStates] = useState<Record<string, VmStatus>>({})
  const [usage, setUsage] = useState<Record<string, VmUsage[]>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<VmConfig | null>(null) // new VM that isn't saved yet
  const [busy, setBusy] = useState(false)
  const [unsaved, setUnsaved] = useState(false)
  // VMs that are hibernating: still running for a few seconds, but saving again would fail
  const [hibernating, setHibernating] = useState<Set<string>>(new Set())
  const [setupFor, setSetupFor] = useState<{ vm: VmConfig; reason: string } | null>(null)
  // bumped for every new draft so its form starts fresh instead of keeping the last one's edits
  const [draftKey, setDraftKey] = useState(0)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0) // dragenter/dragleave fire for every child, count them
  const [droppedIso, setDroppedIso] = useState<string | null>(null)
  const [cloning, setCloning] = useState(false) // the clone dialog is open
  const toasts = useToasts()

  const refresh = useCallback(async () => {
    const list = await window.vmm.list()
    setVms(list)
    setSelected((cur) => (cur && list.some((v) => v.name === cur) ? cur : list[0]?.name ?? null))
  }, [])

  useEffect(() => {
    window.vmm.host().then(setHost)
    refresh()
    window.vmm.states().then((all) => setStates(Object.fromEntries(all.map((s) => [s.name, s.status]))))
    const offState = window.vmm.onState((s: VmRuntimeState) => {
      setStates((cur) => ({ ...cur, [s.name]: s.status }))
      if (s.status === 'off') setUsage(({ [s.name]: _gone, ...rest }) => rest)
      if (s.status === 'off') setHibernating((cur) => (cur.has(s.name) ? new Set([...cur].filter((n) => n !== s.name)) : cur))
    })
    const offCrash = window.vmm.onCrash((c) => toasts.push('error', `${c.name} failed to start`, c.message))
    // an ISO was added to or removed from the ISOs folder
    const offUsage = window.vmm.onUsage((u) =>
      setUsage((cur) => {
        // VMs missing from a sample have stopped, their history goes with them
        const next: Record<string, VmUsage[]> = {}
        for (const [name, sample] of Object.entries(u)) next[name] = [...(cur[name] ?? []), sample].slice(-HISTORY)
        return next
      })
    )
    const offHost = window.vmm.onHostChanged(() => window.vmm.host().then(setHost))
    // only now, with the listeners above in place, so a VM that fails at once still shows up
    window.vmm
      .autostart()
      .then((issues) => {
        for (const i of issues) {
          if (i.error) toasts.push('error', `${i.name} didn't start with the app`, i.error)
          else if (i.warning) toasts.push('error', `${i.name} resumed, but`, i.warning)
        }
      })
      .catch((e) => toasts.push('error', 'Auto-start failed', errText(e)))
    return () => {
      offState()
      offCrash()
      offHost()
      offUsage()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const current = useMemo(() => draft ?? vms.find((v) => v.name === selected) ?? null, [draft, vms, selected])
  const status: VmStatus = current && !draft ? states[current.name] ?? 'off' : 'off'
  const latestUsage = useMemo(() => Object.fromEntries(Object.entries(usage).map(([n, h]) => [n, h[h.length - 1]])), [usage])

  const guard = async (fn: () => Promise<unknown>, failTitle: string) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toasts.push('error', failTitle, errText(e))
    } finally {
      setBusy(false)
    }
  }

  // read after awaits (an ISO copy can take a while), so it can't come from a stale closure
  const draftOpen = useRef(false)
  draftOpen.current = draft !== null
  /** opens a new draft. Returns false if the user kept the one that is already open */
  const startDraft = (cfg: VmConfig) => {
    if (draftOpen.current && !confirm('Discard the new VM you are setting up and start another one?')) return false
    setDraftKey((k) => k + 1)
    setDraft(cfg)
    return true
  }
  const onNew = async () => void startDraft(await window.vmm.newConfig())

  // ---- drop an .iso on the window ----
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files')
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault() // otherwise Electron navigates to the file
    dragDepth.current = 0
    setDragging(false)
    const files = [...e.dataTransfer.files]
    const iso = files.find((f) => f.name.toLowerCase().endsWith('.iso'))
    if (!iso) {
      if (files.length) toasts.push('info', 'Only .iso files can be dropped here')
      return
    }
    setDroppedIso(window.vmm.pathForFile(iso))
  }
  const importIso = (path: string, mode: 'copy' | 'reference') => {
    setDroppedIso(null)
    guard(async () => {
      if (mode === 'copy') toasts.push('info', `Copying ${fileName(path)}`, 'Big ISOs take a minute.')
      const final = await window.vmm.importIso(path, mode)
      setHost(await window.vmm.host())
      // a new VM with the ISO in the drive, ready to fill in
      const cfg = await window.vmm.newConfig()
      if (!startDraft({ ...cfg, iso: final, bootFromIso: true })) toasts.push('ok', `Added ${fileName(final)}`, 'Pick it under CD/DVD on the Hardware tab.')
    }, 'Could not add the ISO')
  }

  const onSave = (cfg: VmConfig, previousName?: string) =>
    guard(async () => {
      const saved = await window.vmm.save(cfg, draft ? undefined : previousName)
      setDraft(null)
      await refresh()
      setSelected(saved.name)
      toasts.push('ok', `Saved ${saved.name}`)
    }, 'Could not save')

  const onDelete = (name: string) => {
    if (!confirm(`Remove "${name}" from the library?\n\nThe disk file is kept, you can delete it from the data folder yourself.`)) return
    guard(async () => {
      await window.vmm.remove(name)
      await refresh()
    }, 'Could not remove VM')
  }

  const onClone = () => {
    if (!current) return
    if (unsaved) {
      toasts.push('info', 'Unsaved hardware changes', 'Save or revert them on the Hardware tab first. The clone is made from the saved settings.')
      return
    }
    setCloning(true)
  }

  const cloneTo = async (name: string, linked: boolean) => {
    if (!current) return
    setBusy(true) // keeps Power on and the rest of the toolbar off until the copy is done
    try {
      const copy = await window.vmm.clone(current.name, name, linked)
      setCloning(false)
      await refresh()
      setSelected(copy.name)
      toasts.push('ok', `Cloned to ${copy.name}`)
    } catch (e) {
      toasts.push('error', 'Clone failed', errText(e))
    } finally {
      setBusy(false)
    }
  }

  const onStart = () => {
    if (!current) return
    if (unsaved) {
      toasts.push('info', 'Unsaved hardware changes', 'Save or revert them on the Hardware tab first, otherwise the VM would boot with the old settings.')
      return
    }
    const name = current.name
    guard(async () => {
      // a save state is only worth keeping to come back to, so Power on resumes it
      const resume = await window.vmm.hasSaveState(name).catch(() => false)
      const r = await window.vmm.start(name, { resume })
      if (r.warning) toasts.push('error', `${name} resumed, but`, r.warning)
      else if (r.resumed) toasts.push('ok', `Resumed ${name}`, 'The save state was used up. Save again to keep a new one.')
    }, `Could not start ${name}`)
  }

  const onSaveState = () => {
    if (!current) return
    const vm = current
    const name = vm.name
    guard(async () => {
      const r = await window.vmm.saveState(name)
      if (r.method === 'needs-setup') {
        setSetupFor({ vm, reason: r.reason })
      } else if (r.method === 'hibernate') {
        setHibernating((cur) => new Set(cur).add(name))
        toasts.push('ok', `Saving ${name}`, 'The guest is saving what is open to its disk and will turn off by itself. Power on brings it back.')
      } else {
        toasts.push('ok', `Saved ${name}`, 'Saved and turned off. Power on resumes from here.')
      }
    }, `Could not save ${name}`)
  }

  // same choice the main process makes: the VM's own setting, or what the host has for auto
  const vmAccel = current?.accel === 'auto' ? host?.accel : current?.accel
  const saveHint =
    vmAccel === 'tcg'
      ? 'Saves memory and disk, then turns the VM off. Power on resumes it.'
      : 'Asks the guest to hibernate: it saves what is open to its own disk and turns off. Needs qemu-guest-agent in the guest.'
  const onPower = (a: PowerAction) => current && guard(() => window.vmm.power(current.name, a), 'Power action failed')

  return (
    <div
      className="app"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        dragDepth.current++
        setDragging(true)
      }}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <header className="titlebar">
        <img className="app-icon" src="./icon.svg" alt="" />
        <span>Virtual Machine Manager</span>
      </header>
      <Toolbar
        vm={draft ? null : current}
        status={status}
        busy={busy}
        onNew={onNew}
        onStart={onStart}
        onPower={onPower}
        onSaveState={onSaveState}
        onClone={onClone}
        saving={Boolean(current && hibernating.has(current.name))}
        saveHint={saveHint}
      />
      <div className="layout">
        <Sidebar
          vms={vms}
          states={states}
          usage={latestUsage}
          selected={draft ? null : selected}
          draftName={draft?.name ?? null}
          onSelect={(n) => {
            setDraft(null)
            setSelected(n)
          }}
        />
        {current ? (
          <VmDetail
            key={draft ? `__draft${draftKey}` : current.name}
            vm={current}
            isDraft={Boolean(draft)}
            status={status}
            host={host}
            usage={draft ? [] : usage[current.name] ?? []}
            onSave={onSave}
            onCancelDraft={() => setDraft(null)}
            onDelete={onDelete}
            onDirtyChange={setUnsaved}
            toast={toasts.push}
            onNeedsSetup={(reason) => setSetupFor({ vm: current, reason })}
          />
        ) : (
          <main className="empty">
            <p className="empty-title">No virtual machines</p>
            <p>Create one, then pick an installer ISO from your ISOs folder. You can also drop an .iso file here.</p>
            <button className="btn primary" onClick={onNew}>
              New virtual machine
            </button>
          </main>
        )}
      </div>
      <StatusBar host={host} running={Object.values(states).filter((s) => s !== 'off').length} />
      <Toasts items={toasts.items} dismiss={toasts.dismiss} />
      {cloning && current && !draft && <CloneDialog source={current.name} taken={vms.map((v) => v.name)} onClone={cloneTo} onClose={() => setCloning(false)} />}
      {setupFor && <GuestSetup vm={setupFor.vm} reason={setupFor.reason} onClose={() => setSetupFor(null)} />}
      {dragging && (
        <div className="drop-overlay" aria-hidden>
          <span>Drop an .iso to make a VM from it</span>
        </div>
      )}
      {droppedIso && (
        <Modal
          title="Add ISO"
          onClose={() => setDroppedIso(null)}
          footer={
            <>
              <span className="spacer" />
              <button className="btn" onClick={() => importIso(droppedIso, 'reference')}>
                Use it where it is
              </button>
              <button className="btn primary" onClick={() => importIso(droppedIso, 'copy')}>
                Copy to ISOs folder
              </button>
            </>
          }
        >
          <p className="mono">{droppedIso}</p>
          <p className="muted">Copying keeps the VM working if the original file is moved or deleted. A new VM opens with this ISO in its CD/DVD drive.</p>
        </Modal>
      )}
    </div>
  )
}
