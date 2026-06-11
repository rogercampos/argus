import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { gotoDefinition } from './lsp'
import { useSearchStore } from './searchStore'
import { activeView, documents, useWorkspaceStore } from './store'
import { useTasksStore } from './tasksStore'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

if (import.meta.env.DEV) {
  // Dev/test hook: lets CDP-driven verification reach application state
  ;(window as unknown as Record<string, unknown>).__argus = {
    workspaceStore: useWorkspaceStore,
    searchStore: useSearchStore,
    tasksStore: useTasksStore,
    documents,
    activeView,
    gotoDefinition
  }
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
