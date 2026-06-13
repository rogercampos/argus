import { memo, useEffect, useMemo, useReducer, useRef } from 'react'
import type { SearchMatch } from '../../../shared/types'
import { type LineSpan, lineSpansFor, onLineHighlightReady } from '../lineHighlight'
import { type SearchTab, useSearchStore } from '../searchStore'
import { useWorkspaceStore } from '../store'
import { Resizer } from './Resizer'
import { FlagToggle } from './SearchModal'
import { SearchPreview } from './SearchPreview'
import { Button } from './ui/Button'
import { EmptyState } from './ui/EmptyState'
import { IconButton } from './ui/IconButton'

/** Rows of the hierarchical results tree: file headers + matches (spec 03). */
type TreeRow =
  | { kind: 'file'; path: string; count: number; collapsed: boolean; firstMatchIndex: number }
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
        collapsed: fileCollapsed,
        firstMatchIndex: matchIndex
      })
    }
    if (!fileCollapsed) rows.push({ kind: 'match', match, matchIndex })
  })
  return rows
}

interface LineSegment {
  from: number
  text: string
  className: string | null
  matched: boolean
}

/** Split a line into render segments: syntax spans cut at match bounds. */
export function buildSegments(
  text: string,
  spans: LineSpan[],
  sub: { start: number; end: number } | null
): LineSegment[] {
  const cuts = new Set([0, text.length])
  for (const span of spans) {
    cuts.add(span.from)
    cuts.add(span.to)
  }
  if (sub) {
    cuts.add(Math.max(0, sub.start))
    cuts.add(Math.min(text.length, sub.end))
  }
  const points = [...cuts].filter((p) => p >= 0 && p <= text.length).sort((a, b) => a - b)
  const segments: LineSegment[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    const span = spans.find((s) => s.from <= from && s.to >= to)
    segments.push({
      from,
      text: text.slice(from, to),
      className: span?.className ?? null,
      matched: sub ? from >= sub.start && to <= sub.end : false
    })
  }
  return segments
}

/** One result line, syntax-highlighted, with the match emphasized. Memoized:
 * selection changes re-render the list but skip unchanged rows. */
const HighlightedMatchText = memo(function HighlightedMatchText({
  match
}: {
  match: SearchMatch
}): React.JSX.Element {
  const [, bump] = useReducer((c: number) => c + 1, 0)
  const spans = lineSpansFor(match.path, match.text)

  // null = grammar still loading (ruby wasm); re-render once it's ready
  useEffect(() => {
    if (spans !== null) return undefined
    return onLineHighlightReady(bump)
  }, [spans])

  const segments = useMemo(
    () => buildSegments(match.text, spans ?? [], match.submatches[0] ?? null),
    [match, spans]
  )

  return (
    <span className="truncate font-mono text-label">
      {segments.map((seg) => (
        <span
          key={seg.from}
          className={
            seg.matched ? 'rounded-sm bg-warning/30 text-warning' : (seg.className ?? undefined)
          }
        >
          {seg.text}
        </span>
      ))}
    </span>
  )
})

function TabHeader(): React.JSX.Element {
  const tabs = useSearchStore((s) => s.tabs)
  const activeTab = useSearchStore((s) => s.activeTab)

  return (
    <div className="flex h-(--size-tabstrip) shrink-0 items-center overflow-x-auto border-b border-edge [scrollbar-width:none]">
      {tabs.map((tab, index) => {
        const active = index === activeTab
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
              className="focus-ring -outline-offset-2 flex h-full cursor-pointer items-center gap-1.5 pl-3 font-mono text-label"
            >
              {tab.results.running ? (
                <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-fg-dim border-t-accent" />
              ) : (
                <span className="text-fg-dim">⌕</span>
              )}
              <span>{title}</span>
              <span className="text-fg-dim">({tab.results.total})</span>
            </button>
            <IconButton
              title="Close tab"
              onClick={() => useSearchStore.getState().closeTab(index)}
              className={`px-2 ${active ? '' : 'opacity-0 group-hover:opacity-100'}`}
            >
              ×
            </IconButton>
          </div>
        )
      })}
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        title="Close all search tabs"
        onClick={() => useSearchStore.getState().closeAllTabs()}
        className="shrink-0"
      >
        Close all
      </Button>
    </div>
  )
}

/** The full-width bottom search panel (spec 03). */
export function SearchPanel(): React.JSX.Element {
  const tabs = useSearchStore((s) => s.tabs)
  const activeTab = useSearchStore((s) => s.activeTab)
  const splitRef = useRef<number>(50)
  const tab = tabs[activeTab] ?? null

  const rows = useMemo(() => (tab ? buildTreeRows(tab) : []), [tab])

  if (!tab) {
    return <EmptyState center>No searches yet — Cmd+Shift+F, then ⌘⏎ to pin one here</EmptyState>
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
        <IconButton
          title="Re-run search"
          onClick={() => useSearchStore.getState().reRunTab(activeTab)}
          className="px-1.5 text-chrome"
        >
          ↻
        </IconButton>
        <span className="font-mono text-label text-fg">{tab.pattern}</span>
        <span className="text-label text-fg-dim tabular-nums">
          {tab.results.running
            ? `${tab.results.total} so far…`
            : `${tab.results.total}${tab.results.capped ? ' (capped)' : ''} results`}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <FlagToggle
            label="Aa"
            title="Case sensitive"
            active={tab.flags.caseSensitive}
            onToggle={() =>
              useSearchStore
                .getState()
                .setTabFlags(activeTab, { caseSensitive: !tab.flags.caseSensitive })
            }
          />
          <FlagToggle
            label="W"
            title="Whole word"
            active={tab.flags.wholeWord}
            onToggle={() =>
              useSearchStore.getState().setTabFlags(activeTab, { wholeWord: !tab.flags.wholeWord })
            }
          />
          <FlagToggle
            label=".*"
            title="Regex"
            active={tab.flags.regex}
            onToggle={() =>
              useSearchStore.getState().setTabFlags(activeTab, { regex: !tab.flags.regex })
            }
          />
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
                onClick={() => {
                  // selecting a file previews its first match (and toggles the group)
                  useSearchStore.getState().selectTabMatch(activeTab, row.firstMatchIndex)
                  useSearchStore.getState().toggleFileCollapsed(activeTab, row.path)
                }}
                className="focus-ring -outline-offset-2 flex h-(--size-row) w-full shrink-0 cursor-pointer items-center gap-1.5 bg-primary/40 px-2 text-left"
              >
                <span
                  className={`text-label text-fg-dim transition-transform ${row.collapsed ? '' : 'rotate-90'}`}
                >
                  ▶
                </span>
                <span className="truncate font-mono text-label text-fg">{row.path}</span>
                <span className="text-label text-fg-dim tabular-nums">({row.count})</span>
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
                className={`focus-ring -outline-offset-2 flex h-(--size-row) w-full shrink-0 cursor-pointer items-center gap-2 pr-2 pl-7 text-left ${
                  row.matchIndex === tab.selectedMatch ? 'bg-selection' : 'hover:bg-hover'
                }`}
              >
                <span className="shrink-0 font-mono text-label text-fg-dim tabular-nums">
                  {row.match.line}
                </span>
                <HighlightedMatchText match={row.match} />
              </button>
            )
          )}
          {tab.results.error && (
            <div className="px-3 py-4 font-mono text-chrome text-error">{tab.results.error}</div>
          )}
          {rows.length === 0 && !tab.results.running && !tab.results.error && (
            <EmptyState>No results</EmptyState>
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
