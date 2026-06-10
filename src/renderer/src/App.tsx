import { useEffect } from 'react'
import { EditorPane } from './components/EditorPane'
import { Sidebar } from './components/Sidebar'
import { useRepoStore } from './store'

function App(): React.JSX.Element {
  const rootPath = useRepoStore((s) => s.rootPath)
  const fileError = useRepoStore((s) => s.fileError)
  const openFolder = useRepoStore((s) => s.openFolder)

  useEffect(() => {
    if (window.api.initialFolder && !useRepoStore.getState().rootPath) {
      void useRepoStore.getState().loadRoot(window.api.initialFolder)
    }
  }, [])

  return (
    <div className="flex h-screen flex-col bg-neutral-900 text-neutral-200">
      <header
        className="flex h-10 shrink-0 items-center justify-between border-b border-neutral-800 pl-20 pr-3"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="truncate font-mono text-xs text-neutral-500">{rootPath ?? 'Argus'}</span>
        <button
          type="button"
          onClick={() => void openFolder()}
          className="rounded bg-neutral-700 px-3 py-1 text-xs font-medium hover:bg-neutral-600"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          Open Folder
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 border-r border-neutral-800">
          <Sidebar />
        </aside>
        <main className="min-w-0 flex-1">
          {fileError ? (
            <div className="flex h-full items-center justify-center px-8 text-sm text-amber-400">
              {fileError}
            </div>
          ) : (
            <EditorPane />
          )}
        </main>
      </div>
    </div>
  )
}

export default App
