import { Welcome } from './components/Welcome'
import { WorkspaceShell } from './components/WorkspaceShell'

function App(): React.JSX.Element {
  if (window.api.windowInit.kind === 'welcome') {
    return <Welcome />
  }
  return <WorkspaceShell />
}

export default App
