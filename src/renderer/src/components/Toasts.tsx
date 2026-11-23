import { useCallback, useState } from 'react'

export type ToastKind = 'ok' | 'error' | 'info'
export interface Toast {
  id: number
  kind: ToastKind
  title: string
  body?: string
}
export type PushToast = (kind: ToastKind, title: string, body?: string) => void

let nextId = 1

export function useToasts() {
  const [items, setItems] = useState<Toast[]>([])
  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), [])
  const push = useCallback<PushToast>(
    (kind, title, body) => {
      const id = nextId++
      setItems((cur) => [...cur, { id, kind, title, body }])
      // errors stay until closed, they usually have something worth reading
      if (kind !== 'error') setTimeout(() => dismiss(id), 3500)
    },
    [dismiss]
  )
  return { items, push, dismiss }
}

export default function Toasts({ items, dismiss }: { items: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          <strong>{t.title}</strong>
          {t.body && <pre>{t.body}</pre>}
        </div>
      ))}
    </div>
  )
}
