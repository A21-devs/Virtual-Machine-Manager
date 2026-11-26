import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { validPort, type PortForward } from '@shared/config'

interface Props {
  forwards: PortForward[]
  onChange: (f: PortForward[]) => void
  disabled: boolean
  /** off while the VM runs, its own QEMU holds these ports then and every row would say "in use" */
  checkPorts: boolean
}

const PRESETS: { label: string; f: PortForward }[] = [
  { label: 'SSH', f: { proto: 'tcp', hostPort: 2222, guestPort: 22 } },
  { label: 'RDP', f: { proto: 'tcp', hostPort: 3389, guestPort: 3389 } },
  { label: 'HTTP', f: { proto: 'tcp', hostPort: 8080, guestPort: 80 } }
]

/** Problems with one row, or null. Exported so the Save button can block on it. */
export function forwardError(list: PortForward[], i: number): string | null {
  const f = list[i]
  if (!validPort(f.hostPort) || !validPort(f.guestPort)) return 'Ports go from 1 to 65535'
  if (list.some((o, j) => j < i && o.proto === f.proto && o.hostPort === f.hostPort)) return `${f.proto.toUpperCase()} ${f.hostPort} is used twice`
  return null
}

export default function PortForwards({ forwards, onChange, disabled, checkPorts }: Props) {
  // keyed "tcp:2222", the same port number can be free on one protocol and taken on the other
  const [inUse, setInUse] = useState<Record<string, boolean>>({})

  // warn about host ports something else on this PC already has bound
  useEffect(() => {
    if (!checkPorts) {
      setInUse({})
      return
    }
    let live = true
    const valid = forwards.filter((f) => validPort(f.hostPort))
    Promise.all(valid.map(async (f) => [`${f.proto}:${f.hostPort}`, !(await window.vmm.isPortFree(f.hostPort, f.proto))] as const)).then(
      (pairs) => live && setInUse(Object.fromEntries(pairs))
    )
    return () => {
      live = false
    }
  }, [forwards, checkPorts])

  const update = (i: number, patch: Partial<PortForward>) => onChange(forwards.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  const add = (f: PortForward) => {
    let host = f.hostPort
    while (forwards.some((o) => o.proto === f.proto && o.hostPort === host)) host++
    onChange([...forwards, { ...f, hostPort: host }])
  }
  // an empty box is NaN while typing, so the row shows its error instead of jumping to 0
  const port = (v: string) => (v === '' ? Number.NaN : Number(v))
  const shown = (n: number) => (Number.isNaN(n) ? '' : n)

  return (
    <div className="forwards">
      {forwards.length > 0 && (
        <table className="fwd-table">
          <thead>
            <tr>
              <th>Protocol</th>
              <th>This PC (127.0.0.1)</th>
              <th>Guest port</th>
              <th>
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {forwards.map((f, i) => {
              const err = forwardError(forwards, i)
              const busy = !err && inUse[`${f.proto}:${f.hostPort}`]
              return (
                <tr key={i}>
                  <td>
                    <select aria-label="Protocol" value={f.proto} disabled={disabled} onChange={(e) => update(i, { proto: e.target.value as PortForward['proto'] })}>
                      <option value="tcp">TCP</option>
                      <option value="udp">UDP</option>
                    </select>
                  </td>
                  <td>
                    <input type="number" aria-label="Host port" min={1} max={65535} value={shown(f.hostPort)} disabled={disabled} onChange={(e) => update(i, { hostPort: port(e.target.value) })} />
                  </td>
                  <td>
                    <input type="number" aria-label="Guest port" min={1} max={65535} value={shown(f.guestPort)} disabled={disabled} onChange={(e) => update(i, { guestPort: port(e.target.value) })} />
                  </td>
                  <td>
                    <button className="icon-btn danger" aria-label="Remove forward" disabled={disabled} onClick={() => onChange(forwards.filter((_f, j) => j !== i))}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                  {(err || busy) && <td className={err ? 'prop-error' : 'warn-text'}>{err ?? 'In use on this PC right now'}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <div className="btn-row">
        <button className="btn small" disabled={disabled} onClick={() => add({ proto: 'tcp', hostPort: 10022, guestPort: 22 })}>
          <Plus size={13} /> Add
        </button>
        {PRESETS.map((p) => (
          <button key={p.label} className="btn small" disabled={disabled} onClick={() => add(p.f)}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}
