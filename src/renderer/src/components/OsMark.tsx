import type { OsType } from '@shared/config'

// Small two-letter badge instead of OS logos (no trademark headaches, and it reads fine at 16px)
const MARK: Record<OsType, { text: string; cls: string }> = {
  linux: { text: 'Lx', cls: 'os-linux' },
  windows: { text: 'Wn', cls: 'os-windows' },
  other: { text: 'VM', cls: 'os-other' }
}

export default function OsMark({ os, large }: { os: OsType; large?: boolean }) {
  const m = MARK[os]
  return (
    <span className={`os-mark ${m.cls} ${large ? 'large' : ''}`} aria-hidden>
      {m.text}
    </span>
  )
}
