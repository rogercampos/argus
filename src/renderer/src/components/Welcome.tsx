import { useEffect, useState } from 'react'
import type { RecentWorkspaceEntry } from '../../../shared/types'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { SectionLabel } from './ui/SectionLabel'

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
      <div className="no-drag flex w-95 flex-col items-center gap-7">
        <div className="text-4xl font-semibold tracking-[0.3em] text-fg/15 select-none">ARGUS</div>

        <div className="flex w-full flex-col gap-2">
          <SectionLabel>Start</SectionLabel>
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => void window.api.openFolderDialog()}
          >
            Open Folder…
          </Button>
        </div>

        {recents.length > 0 && (
          <div className="flex w-full flex-col gap-2">
            <SectionLabel>Recent</SectionLabel>
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
                      className="focus-ring -outline-offset-2 flex min-w-0 flex-1 cursor-pointer items-baseline gap-3 rounded-md px-2.5 py-1.5 text-left"
                    >
                      <span className="text-body text-accent">{name}</span>
                      <span className="truncate font-mono text-label text-fg-dim">
                        {displayPath(entry.path)}
                      </span>
                    </button>
                    <IconButton
                      title="Remove from recent workspaces"
                      onClick={() => {
                        void window.api.removeRecentWorkspace(entry.path).then(() => {
                          setRecents((current) => current.filter((e) => e.path !== entry.path))
                        })
                      }}
                      className="shrink-0 px-2.5 py-1.5 text-body opacity-0 group-hover:opacity-100 hover:text-error"
                    >
                      ×
                    </IconButton>
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
