import { useState } from 'react'
import { Search } from 'lucide-react'
import type { VmConfig } from '@shared/config'
import type { VmStatus } from '@shared/ipc'
import OsMark from './OsMark'
import { statusLabel } from '../util'

interface Props {
  vms: VmConfig[]
  states: Record<string, VmStatus>
  selected: string | null
  draftName: string | null
  onSelect: (name: string) => void
}

export default function Sidebar({ vms, states, selected, draftName, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = q ? vms.filter((v) => v.name.toLowerCase().includes(q)) : vms

  return (
    <aside className="sidebar">
      <div className="side-head">
        <span>Library</span>
        <span className="count">{vms.length}</span>
      </div>
      <div className="side-search">
        <Search size={14} aria-hidden />
        <input placeholder="Filter" aria-label="Filter virtual machines" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <ul className="tree" role="listbox" aria-label="Virtual machines">
        {draftName && (
          <li>
            <div className="row active draft">
              <OsMark os="other" />
              <span className="row-name">{draftName}</span>
              <span className="row-state">new</span>
            </div>
          </li>
        )}
        {shown.map((v) => {
          const s = states[v.name] ?? 'off'
          return (
            <li key={v.name}>
              <button
                role="option"
                aria-selected={selected === v.name}
                className={`row ${selected === v.name ? 'active' : ''}`}
                onClick={() => onSelect(v.name)}
              >
                <OsMark os={v.os} />
                <span className="row-name">{v.name}</span>
                <span className={`row-state ${s}`}>{s === 'off' ? '' : statusLabel[s]}</span>
              </button>
            </li>
          )
        })}
        {q && shown.length === 0 && <li className="tree-empty">No matches</li>}
      </ul>
    </aside>
  )
}
