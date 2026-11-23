// Fake backend so the UI can run in a normal browser (npm run dev:web).
// Handy for working on layout without booting real VMs.
import { defaultConfig, type VmConfig } from '@shared/config'
import type { VmmApi, VmRuntimeState } from '@shared/ipc'

export function installMockApi(): void {
  const disks = 'C:\\Users\\you\\VMs\\disks'
  let vms: VmConfig[] = [
    { ...defaultConfig('Kali', disks), cpus: 8, ramMB: 8192, diskSizeGB: 100, iso: 'C:\\Users\\you\\VMs\\ISOs\\kali-linux-2026.2-installer-amd64.iso', diskBus: 'ide', nic: 'e1000' },
    { ...defaultConfig('Parrot Home', disks), cpus: 6, ramMB: 6144 },
    { ...defaultConfig('Windows 11', disks), os: 'windows', cpus: 8, ramMB: 16384, firmware: 'uefi', diskSizeGB: 128 }
  ]
  const states: Record<string, VmRuntimeState> = {}
  const stateListeners = new Set<(s: VmRuntimeState) => void>()
  const emit = (s: VmRuntimeState) => {
    states[s.name] = s
    stateListeners.forEach((cb) => cb(s))
  }
  const later = (ms: number, fn: () => void) => setTimeout(fn, ms)

  const api: VmmApi = {
    host: async () => ({
      qemuPath: 'C:\\Users\\you\\VMs\\qemu\\qemu-system-x86_64.exe',
      qemuVersion: '11.1.0',
      accel: 'whpx',
      dataRoot: 'C:\\Users\\you\\VMs',
      isos: ['C:\\Users\\you\\VMs\\ISOs\\kali-linux-2026.2-installer-amd64.iso', 'C:\\Users\\you\\VMs\\ISOs\\Parrot-home-7.3_amd64.iso'],
      cpuCount: 24,
      totalRamMB: 31744
    }),
    list: async () => [...vms],
    newConfig: async () => defaultConfig(`New VM ${vms.length + 1}`, disks),
    save: async (cfg, prev) => {
      vms = vms.filter((v) => v.name !== prev && v.name !== cfg.name).concat(cfg)
      return cfg
    },
    remove: async (name) => {
      vms = vms.filter((v) => v.name !== name)
    },
    start: async (name) => {
      emit({ name, status: 'starting', pid: 1234, startedAt: Date.now() })
      later(900, () => emit({ name, status: 'running', pid: 1234, startedAt: Date.now() }))
    },
    power: async (name, action) => {
      const s = states[name]
      if (!s) return
      if (action === 'pause') emit({ ...s, status: 'paused' })
      if (action === 'resume') emit({ ...s, status: 'running' })
      if (action === 'kill' || action === 'shutdown') later(400, () => emit({ name, status: 'off', pid: null, startedAt: null }))
    },
    states: async () => Object.values(states),
    openDataFolder: async () => undefined,
    openLog: async () => undefined,
    readLog: async (name) => `> qemu-system-x86_64.exe -name ${name} -machine q35,accel=whpx,kernel-irqchip=off ...`,
    onState: (cb) => {
      stateListeners.add(cb)
      return () => stateListeners.delete(cb)
    },
    onCrash: () => () => undefined
  }
  window.vmm = api
}
