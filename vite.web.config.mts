// Runs just the UI in a normal browser with a fake backend (see src/renderer/src/mockApi.ts)
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve('src/renderer'),
  resolve: { alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer/src') } },
  plugins: [react()],
  server: { port: 5199, strictPort: true }
})
