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
