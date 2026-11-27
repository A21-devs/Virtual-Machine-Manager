import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}

/** Plain dialog: Esc closes, focus starts on the first field and goes back where it was afterwards. */
export default function Modal({ title, onClose, children, footer, width = 460 }: Props) {
  const box = useRef<HTMLDivElement>(null)
  // the Esc listener is added once, so it reads the latest onClose from here. Otherwise it keeps
  // the one from the first render, and a dialog that refuses to close while busy still closes on Esc
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    // focus the first field, or the dialog itself. Never a button: the Enter that opened
    // the dialog would otherwise go on to "click" it and close the dialog straight away.
    const first = box.current?.querySelector<HTMLElement>('input, select, textarea')
    ;(first ?? box.current)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      before?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={box} tabIndex={-1} style={{ width }}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="modal-x" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  )
}
