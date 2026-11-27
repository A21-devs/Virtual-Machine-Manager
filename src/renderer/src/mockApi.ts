// Fake backend so the UI can run in a normal browser (npm run dev:web).
// Handy for working on layout without booting real VMs.
import { defaultConfig, type VmConfig } from '@shared/config'
import type { AppSettings, Profile, VmmApi, VmRuntimeState, VmUsage } from '@shared/ipc'

// a gray "desktop" so the preview and profile thumbnails have something to show
function fakeScreen(label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#23262b"/><rect y="372" width="640" height="28" fill="#15171a"/><rect x="24" y="24" width="300" height="190" rx="4" fill="#2f343b"/><rect x="24" y="24" width="300" height="22" rx="4" fill="#3a4049"/><text x="36" y="40" fill="#cfd3d8" font-family="Segoe UI" font-size="12">${label}</text><text x="36" y="76" fill="#7fd18b" font-family="Consolas" font-size="12">user@vm:~$ _</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function installMockApi(): void {
  const disks = 'C:\\Users\\you\\VMs\\disks'
  let vms: VmConfig[] = [
    { ...defaultConfig('Kali', disks), cpus: 8, ramMB: 8192, diskSizeGB: 100, iso: 'C:\\Users\\you\\VMs\\ISOs\\kali-linux-2026.2-installer-amd64.iso', diskBus: 'ide', nic: 'e1000', forwards: [{ proto: 'tcp', hostPort: 2222, guestPort: 22 }] },
    { ...defaultConfig('Parrot Home', disks), cpus: 6, ramMB: 6144, autostart: true, resumeLast: true },
    { ...defaultConfig('Windows 11', disks), os: 'windows', cpus: 8, ramMB: 16384, firmware: 'uefi', diskSizeGB: 128 }
  ]
  const states: Record<string, VmRuntimeState> = {}
  const stateListeners = new Set<(s: VmRuntimeState) => void>()
  const emit = (s: VmRuntimeState) => {
    states[s.name] = s
    stateListeners.forEach((cb) => cb(s))
  }
  const later = (ms: number, fn: () => void) => setTimeout(fn, ms)
  const saved = new Set<string>(['Parrot Home'])
  const day = 86_400_000
  const profiles: Record<string, Profile[]> = {
    Kali: [
      { tag: 'p1', label: 'Tools set up', note: 'burp, ffuf, wordlists', created: Date.now() - 2 * day, kind: 'session', hasShot: true },
      { tag: 'p0', label: 'Clean install', note: 'updated, nothing else', created: Date.now() - 9 * day, kind: 'session', hasShot: true }
    ]
  }
  const running = (name: string) => (states[name]?.status ?? 'off') !== 'off'
  // the first live save of each VM pretends the guest agent is missing, so the setup dialog can be tried
  const agentReady = new Set<string>()
  const isos = ['C:\\Users\\you\\VMs\\ISOs\\kali-linux-2026.2-installer-amd64.iso', 'C:\\Users\\you\\VMs\\ISOs\\Parrot-home-7.3_amd64.iso']

  const startRoot = 'C:\\Users\\you\\VMs'
  let settings: AppSettings = { dataRoot: startRoot, qemuPath: '' }
  const looksLikeQemu = (p: string) => /qemu-system-x86_64\.exe$/i.test(p)

  const api: VmmApi = {
    host: async () => ({
      qemuPath: settings.qemuPath || 'C:\\Users\\you\\VMs\\qemu\\qemu-system-x86_64.exe',
      qemuVersion: '11.1.0',
      accel: 'whpx',
      dataRoot: startRoot, // like the real app, a new data folder is only used after a restart
      isos: [...isos],
      cpuCount: 24,
      totalRamMB: 31744
    }),
    list: async () => [...vms],
    newConfig: async (name) => defaultConfig(name?.trim() || `New VM ${vms.length + 1}`, disks),
    save: async (cfg, prev) => {
      if (prev && prev !== cfg.name && profiles[prev]) {
        profiles[cfg.name] = profiles[prev]
        delete profiles[prev]
      }
      vms = vms.filter((v) => v.name !== prev && v.name !== cfg.name).concat(cfg)
      return cfg
    },
    remove: async (name) => {
      vms = vms.filter((v) => v.name !== name)
    },
    autostart: async () => [],
    start: async (name, opts) => {
      const resumed = Boolean(opts?.resume && saved.delete(name))
      emit({ name, status: 'starting', pid: 1234, startedAt: Date.now() })
      later(900, () => emit({ name, status: 'running', pid: 1234, startedAt: Date.now() }))
      return { resumed }
    },
    power: async (name, action) => {
      const s = states[name]
      if (!s) return
      if (action === 'pause') emit({ ...s, status: 'paused' })
      if (action === 'resume') emit({ ...s, status: 'running' })
      if (action === 'kill' || action === 'shutdown') later(400, () => emit({ name, status: 'off', pid: null, startedAt: null }))
    },
    states: async () => Object.values(states),
    saveState: async (name) => {
      // the mock pretends to be WHPX: the guest hibernates and powers off by itself
      later(1500, () => emit({ name, status: 'off', pid: null, startedAt: null }))
      return { method: 'hibernate' }
    },
    hasSaveState: async (name) => saved.has(name),
    discardSaveState: async (name) => void saved.delete(name),
    profiles: async (name) => [...(profiles[name] ?? [])],
    takeProfile: async (name, label, note) => {
      if (!running(name)) throw new Error('Power the VM on to save a profile of it')
      if (states[name]?.status !== 'running') throw new Error('Resume the VM first, a paused guest cannot save itself')
      if (!agentReady.has(name)) {
        agentReady.add(name)
        throw new Error('needs-guest-setup: The guest agent is not answering.')
      }
      await new Promise((r) => setTimeout(r, 1500))
      const p: Profile = { tag: `p${Date.now().toString(36)}`, label: label.trim(), note: note.trim(), created: Date.now(), kind: 'session', hasShot: true }
      profiles[name] = [p, ...(profiles[name] ?? [])]
      return p
    },
    launchProfile: async (name, _tag, force) => {
      if (running(name) && !force) throw new Error('vm-running')
      if (running(name)) {
        emit({ name, status: 'off', pid: null, startedAt: null })
        await new Promise((r) => setTimeout(r, 300))
      }
      await api.start(name)
    },
    deleteProfile: async (name, tag) => {
      profiles[name] = (profiles[name] ?? []).filter((p) => p.tag !== tag)
    },
    editProfile: async (name, tag, label, note) => {
      profiles[name] = (profiles[name] ?? []).map((p) => (p.tag === tag ? { ...p, label: label.trim(), note: note.trim() } : p))
    },
    profileShot: async (name, tag) => fakeScreen(`${name} · ${tag}`),
    // the clock changes every refresh, so it's easy to see the preview update
    preview: async (name) => (running(name) ? fakeScreen(`${name} · ${new Date().toLocaleTimeString()}`) : null),
    // pretend Remote Desktop is on, so the in-use warning can be seen in dev:web
    isPortFree: async (port, proto) => !(proto === 'tcp' && port === 3389),
    guestSetupCommand: async () => 'curl -sL 10.0.2.2:7777/s | sudo bash',
    // a browser doesn't hand out real paths, pretend the file came from Downloads
    pathForFile: (file) => `C:\\Users\\you\\Downloads\\${file.name}`,
    clone: async (name, newName, linked) => {
      await new Promise((r) => setTimeout(r, linked ? 300 : 1500)) // a full copy takes a while
      const src = vms.find((v) => v.name === name)
      if (!src) throw new Error(`No VM called "${name}"`)
      if (running(name)) throw new Error(`Power off ${name} before you clone it.`)
      const n = newName.trim()
      if (vms.some((v) => v.name.toLowerCase() === n.toLowerCase())) throw new Error(`A VM called "${n}" already exists`)
      const copy = { ...src, name: n, diskPath: `${disks}\\${n}.qcow2`, autostart: false, resumeLast: false }
      vms = [...vms, copy]
      return copy
    },
    diskInfo: async (name) => {
      const v = vms.find((x) => x.name === name)
      const size = (v?.diskSizeGB ?? 64) * 1024 ** 3
      return { exists: true, virtualBytes: size, actualBytes: Math.round(size * 0.31), backingFile: null, snapshotCount: profiles[name]?.length ?? 0 }
    },
    resizeDisk: async (name, sizeGB) => {
      if (running(name)) throw new Error(`Power off ${name} before you resize its disk.`)
      const v = vms.find((x) => x.name === name)
      if (v && sizeGB < v.diskSizeGB) throw new Error(`The disk is already ${v.diskSizeGB} GB. It can only grow.`)
      vms = vms.map((x) => (x.name === name ? { ...x, diskSizeGB: sizeGB } : x))
    },
    compactDisk: async (name) => {
      if (running(name)) throw new Error(`Power off ${name} before you compact its disk.`)
      await new Promise((r) => setTimeout(r, 1200))
      return { before: 31 * 1024 ** 3, after: 22 * 1024 ** 3 }
    },
    // a browser has no file picker that hands out paths
    pickFile: async () => null,
    pickFolder: async () => null,
    settings: async () => ({ ...settings }),
    saveSettings: async (s) => {
      if (s.qemuPath && !looksLikeQemu(s.qemuPath)) throw new Error("That file doesn't run as QEMU. Pick qemu-system-x86_64.exe from your QEMU folder.")
      settings = { ...s }
      return { restartNeeded: s.dataRoot.toLowerCase() !== startRoot.toLowerCase() }
    },
    checkQemu: async (p) => (looksLikeQemu(p) ? '11.1.0' : null),
    relaunch: async () => {
      if (Object.values(states).some((s) => s.status !== 'off')) throw new Error('Power off the running VMs first, a restart would cut them off.')
      location.reload()
    },
    importIso: async (path, mode) => {
      await new Promise((r) => setTimeout(r, mode === 'copy' ? 800 : 100))
      const final = mode === 'copy' ? `C:\\Users\\you\\VMs\\ISOs\\${path.split('\\').pop()}` : path
      if (!isos.includes(final)) isos.push(final)
      return final
    },
    openDataFolder: async () => undefined,
    openLog: async () => undefined,
    readLog: async (name) => `> qemu-system-x86_64.exe -name ${name} -machine q35,accel=whpx,kernel-irqchip=off ...`,
    onState: (cb) => {
      stateListeners.add(cb)
      return () => stateListeners.delete(cb)
    },
    onCrash: () => () => undefined,
    onUsage: (cb) => {
      // made-up numbers that wobble a bit, so the UI has something to draw
      const t = setInterval(() => {
        const u: Record<string, VmUsage> = {}
        for (const s of Object.values(states)) {
          if (s.status === 'off') continue
          const vm = vms.find((v) => v.name === s.name)
          u[s.name] = { cpuPercent: s.status === 'paused' ? 0 : 4 + Math.random() * 18, memMB: Math.round((vm?.ramMB ?? 2048) * (0.55 + Math.random() * 0.05)) }
        }
        cb(u)
      }, 2000)
      return () => clearInterval(t)
    },
    onHostChanged: () => () => undefined
  }
  window.vmm = api
}
