import { FolderOpen } from 'lucide-react'
import type { HostInfo } from '@shared/ipc'

export default function StatusBar({ host, running }: { host: HostInfo | null; running: number }) {
  if (!host) return <footer className="statusbar">Checking host…</footer>
  return (
    <footer className="statusbar">
      {host.qemuPath ? (
        <span>QEMU {host.qemuVersion ?? ''}</span>
      ) : (
        <span className="sb-bad">QEMU not found</span>
      )}
      <span className={host.accel === 'whpx' ? 'sb-good' : 'sb-warn'}>
        {host.accel === 'whpx' ? 'Hyper-V acceleration (WHPX)' : 'Software emulation, slow'}
      </span>
      <span>
        {host.cpuCount} threads · {Math.round(host.totalRamMB / 1024)} GB RAM
      </span>
      <span>{running} running</span>
      <span className="spacer" />
      <button className="sb-link" onClick={() => window.vmm.openDataFolder()} title={host.dataRoot}>
        <FolderOpen size={13} /> {host.dataRoot}
      </button>
    </footer>
  )
}
