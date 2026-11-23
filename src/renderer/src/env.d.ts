/// <reference types="vite/client" />
import type { VmmApi } from '../../preload/index'

declare global {
  interface Window {
    vmm: VmmApi
  }
}
