import { useWorkspaceStore } from '../store'

const SEVERITY_ICONS: Record<number, { icon: string; cls: string }> = {
  1: { icon: '●', cls: 'text-error' },
  2: { icon: '▲', cls: 'text-warning' },
  3: { icon: 'ℹ', cls: 'text-accent' },
  4: { icon: '·', cls: 'text-fg-dim' }
}

/** Problems view (spec 12): all diagnostics grouped by file. */
export function ProblemsView(): React.JSX.Element {
  const problems = useWorkspaceStore((s) => s.problems)

  if (problems.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-fg-dim">
        No problems detected
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto py-1">
      {problems.map(({ path, diagnostics }) => (
        <div key={path}>
          <div className="flex items-center gap-2 bg-primary/40 px-2 py-1">
            <span className="truncate font-mono text-[11px] text-fg">{path}</span>
            <span className="text-[10px] text-fg-dim">({diagnostics.length})</span>
          </div>
          {diagnostics.map((d) => {
            const sev = SEVERITY_ICONS[d.severity] ?? SEVERITY_ICONS[4]
            return (
              <button
                type="button"
                key={`${d.source}:${d.startLine}:${d.startChar}:${d.message.slice(0, 40)}`}
                onClick={() =>
                  void useWorkspaceStore
                    .getState()
                    .navigateTo(path, { line: d.startLine + 1, col: d.startChar + 1 })
                }
                className="flex w-full cursor-pointer items-baseline gap-2 px-3 py-0.5 text-left hover:bg-hover"
              >
                <span className={`shrink-0 text-[10px] ${sev.cls}`}>{sev.icon}</span>
                <span className="shrink-0 font-mono text-[10px] text-fg-dim">
                  {d.startLine + 1}:{d.startChar + 1}
                </span>
                <span className="shrink-0 rounded bg-hover px-1 text-[9px] text-fg-dim">
                  {d.source}
                </span>
                <span className="truncate text-[11px]">{d.message}</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
