import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useWorkspaceStore } from './store'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

if (import.meta.env.DEV) {
  // Dev/test hook: lets CDP-driven verification reach application state
  ;(window as unknown as Record<string, unknown>).__argus = { workspaceStore: useWorkspaceStore }
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
