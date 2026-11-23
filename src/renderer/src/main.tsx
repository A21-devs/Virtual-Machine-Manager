import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installMockApi } from './mockApi'
import './styles.css'

// running in a plain browser (npm run dev:web) instead of Electron
if (!window.vmm) installMockApi()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
