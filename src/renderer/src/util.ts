/** Electron wraps errors from ipcMain.handle, strip that so users see the real message. */
export const errText = (e: unknown) =>
  String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p

export const gb = (mb: number) => {
  const v = mb / 1024
  return `${Number.isInteger(v) ? v : v.toFixed(1)} GB`
}

export const statusLabel = {
  off: 'Powered off',
  starting: 'Starting',
  running: 'Running',
  paused: 'Paused'
} as const

export const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** a file size for people: 512 KB, 340 MB, 12.4 GB */
export const bytes = (n: number) => {
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(0)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}
