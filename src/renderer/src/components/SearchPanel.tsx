import { useMemo, useRef } from 'react'
import type { SearchMatch } from '../../../shared/types'
import { type SearchTab, useSearchStore } from '../searchStore'
import { useWorkspaceStore } from '../store'
import { ProblemsView } from './ProblemsView'
import { Resizer } from './Resizer'
import { FlagToggle } from './SearchModal'
import { SearchPreview } from './SearchPreview'

/** Rows of the hierarchical results tree: file headers + matches (spec 03). */
type TreeRow =
  | { kind: 'file'; path: string; count: number; collapsed: boolean }
  | { kind: 'match'; match: SearchMatch; matchIndex: number }

export function buildTreeRows(tab: SearchTab): TreeRow[] {
  const rows: TreeRow[] = []
  const collapsed = new Set(tab.collapsedFiles)
  let currentFile: string | null = null
  let fileCollapsed = false
  const counts = new Map<string, number>()
  for (const m of tab.results.matches) counts.set(m.path, (counts.get(m.path) ?? 0) + 1)

  tab.results.matches.forEach((match, matchIndex) => {
    if (match.path !== currentFile) {
      currentFile = match.path
      fileCollapsed = collapsed.has(match.path)
      rows.push({
        kind: 'file',
        path: match.path,
        count: counts.get(match.path) ?? 0,
        collapsed: fileCollapsed
      })
    }
    if (!fileCollapsed) rows.push({ kind: 'match', match, matchIndex })
  })
  return rows
}

function TabHeader(): React.JSX.Element {
  const tabs = useSearchStore((s) => s.tabs)
  const activeTab = useSearchStore((s) => s.activeTab)
  const problemsView = useSearchStore((s) => s.problemsView)
  const problemCount = useWorkspaceStore((s) => s.problems.length)

  return (
    <div className="flex h-[32px] shrink-0 items-center overflow-x-auto border-b border-edge [scrollbar-width:none]">
      {/* Pinned Problems tab (spec 12) */}
      <button
        type="button"
        onClick={() => useSearchStore.getState().showProblems()}
        className={`flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 text-[11px] ${
          problemsView ? 'border-caret bg-primary text-white' : 'border-transparent text-fg-dim'
        }`}
      >
        Problems{problemCount > 0 ? ` (${problemCount})` : ''}
      </button>
      {tabs.map((tab, index) => {
        const active = index === activeTab && !problemsView
        const title = tab.pattern.length > 30 ? `${tab.pattern.slice(0, 30)}…` : tab.pattern
        return (
          <div
            key={tab.id}
            className={`group flex h-full shrink-0 items-center border-b-2 ${
              active ? 'border-caret bg-primary text-white' : 'border-transparent text-fg-dim'
            }`}
          >
            <button
              type="button"
              onClick={() => useSearchStore.getState().activateTab(index)}
              className="flex h-full cursor-pointer items-center gap-1.5 pl-3 font-mono text-[11px]"
            >
              {tab.results.running ? (
                <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-fg-dim border-t-accent" />
              ) : (
                <span className="text-fg-dim">⌕</span>
              )}
              <span>{title}</span>
              <span className="text-fg-dim">({tab.results.total})</span>
            </button>
            <button
              type="button"
              onClick={() => useSearchStore.getState().closeTab(index)}
              className={`cursor-pointer px-2 text-fg-dim hover:text-fg ${
                active ? '' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              ×
            </button>
          </div>
        )
      })}
      <div className="flex-1" />
      <button
        type="button"
        title="Close all search tabs"
        onClick={() => useSearchStore.getState().closeAllTabs()}
        className="shrink-0 cursor-pointer px-3 text-[11px] text-fg-dim hover:text-fg"
      >
        Close all
      </button>
    </div>
  )
}

/** The full-width bottom search panel (spec 03) with a pinned Problems tab. */
export function SearchPanel(): React.JSX.Element {
  const tabs = useSearchStore((s) => s.tabs)
  const activeTab = useSearchStore((s) => s.activeTab)
  const problemsView = useSearchStore((s) => s.problemsView)
  const splitRef = useRef<number>(50)
  const tab = problemsView ? null : (tabs[activeTab] ?? null)

  const rows = useMemo(() => (tab ? buildTreeRows(tab) : []), [tab])

  if (!tab) {
    return (
      <div className="flex h-full flex-col">
        <TabHeader />
        <ProblemsView />
      </div>
    )
  }

  const selected = tab.results.matches[tab.selectedMatch] ?? null

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const store = useSearchStore.getState()
    const visibleMatches = rows.filter((r) => r.kind === 'match') as Extract<
      TreeRow,
      { kind: 'match' }
    >[]
    const pos = visibleMatches.findIndex((r) => r.matchIndex === tab.selectedMatch)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = visibleMatches[(pos + 1) % Math.max(1, visibleMatches.length)]
      if (next) store.selectTabMatch(activeTab, next.matchIndex)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev =
        visibleMatches[(pos - 1 + visibleMatches.length) % Math.max(1, visibleMatches.length)]
      if (prev) store.selectTabMatch(activeTab, prev.matchIndex)
    } else if (e.key === 'Enter' && selected) {
      e.preventDefault()
      void useWorkspaceStore.getState().navigateTo(selected.path, { line: selected.line })
    }
  }

  return (
    <div className="flex h-full flex-col">
      <TabHeader />
      <div className="flex shrink-0 items-center gap-1 border-b border-edge px-2 py-1">
        <button
          type="button"
          title="Re-run search"
          onClick={() => useSearchStore.getState().reRunTab(activeTab)}
          className="cursor-pointer rounded px-1.5 text-[12px] text-fg-dim hover:bg-hover hover:text-fg"
        >
          ↻
        </button>
        <span className="font-mono text-[11px] text-fg">{tab.pattern}</span>
        <span className="text-[11px] text-fg-dim">
          {tab.results.running
            ? `${tab.results.total} so far…`
            : `${tab.results.total}${tab.results.capped ? ' (capped)' : ''} results`}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <FlagToggle
            label="Aa"
            title="Case sensitive"
            active={tab.flags.caseSensitive}
            onToggle={() => {}}
          />
          <FlagToggle
            label="W"
            title="Whole word"
            active={tab.flags.wholeWord}
            onToggle={() => {}}
          />
          <FlagToggle label=".*" title="Regex" active={tab.flags.regex} onToggle={() => {}} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div
          role="listbox"
          style={{ width: `${splitRef.current}%` }}
          className="flex flex-col overflow-y-auto border-r border-edge outline-none"
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          {rows.map((row) =>
            row.kind === 'file' ? (
              <button
                type="button"
                key={`f:${row.path}`}
                onClick={() => useSearchStore.getState().toggleFileCollapsed(activeTab, row.path)}
                className="flex h-[26px] w-full shrink-0 cursor-pointer items-center gap-1.5 bg-primary/40 px-2 text-left"
              >
                <span
                  className={`text-[10px] text-fg-dim transition-transform ${row.collapsed ? '' : 'rotate-90'}`}
                >
                  ▶
                </span>
                <span className="truncate font-mono text-[11px] text-fg">{row.path}</span>
                <span className="text-[10px] text-fg-dim">({row.count})</span>
              </button>
            ) : (
              <button
                type="button"
                key={`m:${row.matchIndex}`}
                onClick={() => useSearchStore.getState().selectTabMatch(activeTab, row.matchIndex)}
                onDoubleClick={() =>
                  void useWorkspaceStore
                    .getState()
                    .navigateTo(row.match.path, { line: row.match.line })
                }
                className={`flex h-[24px] w-full shrink-0 cursor-pointer items-center gap-2 pr-2 pl-7 text-left ${
                  row.matchIndex === tab.selectedMatch ? 'bg-selection' : 'hover:bg-hover'
                }`}
              >
                <span className="shrink-0 font-mono text-[10px] text-fg-dim">{row.match.line}</span>
                <span className="truncate font-mono text-[11px]">
                  {row.match.submatches[0] ? (
                    <>
                      {row.match.text.slice(0, row.match.submatches[0].start)}
                      <span className="rounded-sm bg-warning/30 text-warning">
                        {row.match.text.slice(
                          row.match.submatches[0].start,
                          row.match.submatches[0].end
                        )}
                      </span>
                      {row.match.text.slice(row.match.submatches[0].end)}
                    </>
                  ) : (
                    row.match.text
                  )}
                </span>
              </button>
            )
          )}
          {rows.length === 0 && !tab.results.running && (
            <div className="px-3 py-4 text-[12px] text-fg-dim">No results</div>
          )}
        </div>
        <Resizer direction="horizontal" onDrag={() => {}} />
        <div className="min-w-0 flex-1">
          <SearchPreview match={selected} />
        </div>
      </div>
    </div>
  )
}
