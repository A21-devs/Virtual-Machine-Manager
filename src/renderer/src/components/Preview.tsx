import { useEffect, useState } from 'react'
import type { VmStatus } from '@shared/ipc'

const EVERY_MS = 2000

const label: Record<VmStatus, string> = {
  off: 'Powered off',
  starting: 'Starting…',
  running: 'Waiting for the screen…',
  paused: 'Suspended'
}

/**
 * Small live view of the VM's screen on the Summary tab. Refreshed every 2 s with
 * QMP screendump, but only while this window is visible and focused.
 */
export default function Preview({ name, status }: { name: string; status: VmStatus }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    setSrc(null)
    if (status !== 'running' && status !== 'paused') return
    let live = true
    let busy = false // one request at a time, a focus event mid-request must not start a second loop
    let timer: number | undefined
    const tick = async () => {
      window.clearTimeout(timer)
      if (busy) return
      busy = true
      // don't make QEMU encode PNGs nobody is looking at
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        const img = await window.vmm.preview(name).catch(() => null)
        if (live && img) setSrc(img)
      }
      busy = false
      // a paused guest's screen doesn't change, one picture is enough
      if (live && status === 'running') timer = window.setTimeout(tick, EVERY_MS)
    }
    tick()
    // coming back to the app shows the current screen right away instead of up to 2 s later
    const onFocus = () => void tick()
    window.addEventListener('focus', onFocus)
    return () => {
      live = false
      window.clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [name, status])

  return (
    <div className={`screen ${status}`}>
      {src ? <img src={src} alt={`Screen of ${name}`} /> : <span>{label[status]}</span>}
    </div>
  )
}
