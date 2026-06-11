import { useEffect, useState } from 'react'
import type { RecentWorkspaceEntry } from '../../../shared/types'

function displayPath(path: string): string {
  // `~` for home everywhere (spec 13)
  return path.replace(/^\/Users\/[^/]+/, '~')
}

export function Welcome(): React.JSX.Element {
  const [recents, setRecents] = useState<RecentWorkspaceEntry[]>([])

  useEffect(() => {
    void window.api.recentWorkspaces(8).then(setRecents)
  }, [])

  return (
    <div className="shell-gradient drag-region flex h-screen flex-col items-center justify-center">
      <div className="no-drag flex w-95 flex-col items-center">
        <div className="mb-8 text-4xl font-bold tracking-[0.3em] text-fg/15 select-none">ARGUS</div>

        <div className="w-full">
          <div className="mb-2 text-[11px] font-semibold tracking-wider text-fg-dim uppercase">
            Start
          </div>
          <button
            type="button"
            onClick={() => void window.api.openFolderDialog()}
            className="cursor-pointer rounded-md border border-edge bg-secondary px-5 py-2 text-[13px] hover:bg-hover"
          >
            Open Folder…
          </button>
        </div>

        {recents.length > 0 && (
          <div className="mt-7 w-full">
            <div className="mb-2 text-[11px] font-semibold tracking-wider text-fg-dim uppercase">
              Recent
            </div>
            <div className="flex max-h-56 flex-col overflow-y-auto">
              {recents.map((entry) => {
                const name = entry.path.split('/').filter(Boolean).pop()
                return (
                  <div
                    key={entry.path}
                    className="group flex items-center rounded-md hover:bg-hover"
                  >
                    <button
                      type="button"
                      onClick={() => void window.api.openWorkspace(entry.path)}
                      className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-3 px-2.5 py-1.5 text-left"
                    >
                      <span className="text-[13px] text-accent">{name}</span>
                      <span className="truncate font-mono text-[11px] text-fg-dim">
                        {displayPath(entry.path)}
                      </span>
                    </button>
                    <button
                      type="button"
                      title="Remove from recent workspaces"
                      onClick={() => {
                        void window.api.removeRecentWorkspace(entry.path).then(() => {
                          setRecents((current) => current.filter((e) => e.path !== entry.path))
                        })
                      }}
                      className="shrink-0 cursor-pointer px-2.5 py-1.5 text-[13px] text-fg-dim opacity-0 group-hover:opacity-100 hover:text-error"
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
