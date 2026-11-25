import { useCallback, useEffect, useMemo, useState } from 'react'
import type { VmConfig } from '@shared/config'
import type { HostInfo, PowerAction, VmRuntimeState, VmStatus } from '@shared/ipc'
import Sidebar from './components/Sidebar'
import Toolbar from './components/Toolbar'
import VmDetail from './components/VmDetail'
import StatusBar from './components/StatusBar'
import Toasts, { useToasts } from './components/Toasts'
import GuestSetup from './components/GuestSetup'
import { errText } from './util'

export default function App() {
  const [host, setHost] = useState<HostInfo | null>(null)
  const [vms, setVms] = useState<VmConfig[]>([])
  const [states, setStates] = useState<Record<string, VmStatus>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<VmConfig | null>(null) // new VM that isn't saved yet
  const [busy, setBusy] = useState(false)
  const [unsaved, setUnsaved] = useState(false)
  // VMs that are hibernating: still running for a few seconds, but saving again would fail
  const [hibernating, setHibernating] = useState<Set<string>>(new Set())
  const [setupFor, setSetupFor] = useState<{ vm: VmConfig; reason: string } | null>(null)
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
      if (s.status === 'off') setHibernating((cur) => (cur.has(s.name) ? new Set([...cur].filter((n) => n !== s.name)) : cur))
    })
    const offCrash = window.vmm.onCrash((c) => toasts.push('error', `${c.name} failed to start`, c.message))
    // an ISO was added to or removed from the ISOs folder
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const current = useMemo(() => draft ?? vms.find((v) => v.name === selected) ?? null, [draft, vms, selected])
  const status: VmStatus = current && !draft ? states[current.name] ?? 'off' : 'off'

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

  const onNew = async () => setDraft(await window.vmm.newConfig())

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
    <div className="app">
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
        saving={Boolean(current && hibernating.has(current.name))}
        saveHint={saveHint}
      />
      <div className="layout">
        <Sidebar
          vms={vms}
          states={states}
          selected={draft ? null : selected}
          draftName={draft?.name ?? null}
          onSelect={(n) => {
            setDraft(null)
            setSelected(n)
          }}
        />
        {current ? (
          <VmDetail
            key={draft ? '__draft' : current.name}
            vm={current}
            isDraft={Boolean(draft)}
            status={status}
            host={host}
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
            <p>Create one, then pick an installer ISO from your ISOs folder.</p>
            <button className="btn primary" onClick={onNew}>
              New virtual machine
            </button>
          </main>
        )}
      </div>
      <StatusBar host={host} running={Object.values(states).filter((s) => s !== 'off').length} />
      <Toasts items={toasts.items} dismiss={toasts.dismiss} />
      {setupFor && <GuestSetup vm={setupFor.vm} reason={setupFor.reason} onClose={() => setSetupFor(null)} />}
    </div>
  )
}
