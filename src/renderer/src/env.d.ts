/// <reference types="vite/client" />
import type { VmmApi } from '@shared/ipc'

declare global {
  interface Window {
    vmm: VmmApi
  }
}
