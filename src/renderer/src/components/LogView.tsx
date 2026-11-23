import { useEffect, useRef, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import type { VmStatus } from '@shared/ipc'

export default function LogView({ name, status }: { name: string; status: VmStatus }) {
  const [text, setText] = useState<string | null>(null)
  const pre = useRef<HTMLPreElement>(null)

  const load = () => window.vmm.readLog(name).then(setText)

  useEffect(() => {
    load()
    // keep following the log while the VM runs
    if (status === 'off') return
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, status])

  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight
  }, [text])

  return (
    <div className="logview">
      <div className="log-actions">
        <span className="muted">QEMU command line and output from the last launch</span>
        <span className="spacer" />
        <button className="btn small" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
        <button className="btn small" onClick={() => window.vmm.openLog(name)}>
          <ExternalLink size={13} /> Open file
        </button>
      </div>
      <pre ref={pre} className="log mono">
        {text === null ? 'Loading…' : text || 'No log yet. It appears after the VM is started once.'}
      </pre>
    </div>
  )
}
