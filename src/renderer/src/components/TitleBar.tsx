import { useWorkspaceStore } from '../store'

const STATE_LABELS: Record<string, string> = {
  rebasing: 'Rebasing',
  merging: 'Merging',
  'cherry-picking': 'Cherry-picking',
  reverting: 'Reverting'
}

export function TitleBar(): React.JSX.Element {
  const rootName = useWorkspaceStore((s) => s.rootName)
  const git = useWorkspaceStore((s) => s.gitState)

  return (
    <header className="drag-region flex h-9.5 shrink-0 items-center gap-3 pr-3 pl-20">
      <span className="text-body font-semibold text-fg">{rootName}</span>
      {git.isRepo && git.branch && (
        <span className="flex items-center gap-1 text-chrome text-fg-dim">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0Z" />
          </svg>
          {git.branch}
          {git.state && (
            <span className="text-warning">({STATE_LABELS[git.state] ?? git.state})</span>
          )}
        </span>
      )}
    </header>
  )
}
