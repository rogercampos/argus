import { DiffApp } from './components/diff/DiffApp'
import { Welcome } from './components/Welcome'
import { WorkspaceShell } from './components/WorkspaceShell'

function App(): React.JSX.Element {
  if (window.api.windowInit.kind === 'welcome') {
    return <Welcome />
  }
  if (window.api.windowInit.kind === 'diff') {
    return <DiffApp />
  }
  return <WorkspaceShell />
}

export default App
