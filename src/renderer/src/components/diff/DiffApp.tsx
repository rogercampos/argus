import { openSearchPanel } from '@codemirror/search'
import { useCallback, useEffect, useRef, useState } from 'react'
import { lastFocusedDiffEditor } from '../../diffEditor'
import { filteredFiles, useDiffStore } from '../../diffStore'
import { Resizer } from '../Resizer'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { DiffFileCard } from './DiffFileCard'
import { DiffSidebar } from './DiffSidebar'
import { DiffTargetPicker } from './DiffTargetPicker'
import { DiffStat } from './diffBits'

/**
 * The diff review window: a standalone view of one comparison (uncommitted
 * changes, a commit, a range, a PR) — every changed file stacked in one
 * scrolling column, with a file list to jump around and per-file "viewed"
 * marks. Unrelated to any workspace; no tabs, no tree, no LSP.
 *
 * Keys (outside text fields): j/k next/previous file, v toggle viewed,
 * r refresh.
 */

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** A file's top counts as "reached" this far below the scroll area's top. */
const ACTIVE_OFFSET = 48

export function DiffApp(): React.JSX.Element {
  const status = useDiffStore((s) => s.status)
  const summary = useDiffStore((s) => s.summary)
  const error = useDiffStore((s) => s.error)
  const source = useDiffStore((s) => s.source)
  const layout = useDiffStore((s) => s.layout)
  const generation = useDiffStore((s) => s.generation)
  const filter = useDiffStore((s) => s.filter)
  const repoPath = useDiffStore((s) => s.repoPath)

  const [sidebarWidth, setSidebarWidth] = useState(280)
  const scrollRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const { load, source: initial } = useDiffStore.getState()
    void load(initial)
  }, [])

  useEffect(() => {
    const repoName = repoPath.split('/').pop() ?? repoPath
    document.title = summary ? `${repoName} — ${summary.title}` : `${repoName} — Diff`
  }, [repoPath, summary])

  const files = summary ? filteredFiles(summary.files, filter) : []

  const scrollToFile = useCallback((path: string) => {
    const container = scrollRef.current
    const card = container?.querySelector<HTMLElement>(`[data-diff-path="${CSS.escape(path)}"]`)
    if (!container || !card) return
    container.scrollTo({ top: card.offsetTop - 12 })
    useDiffStore.getState().setActivePath(path)
  }, [])

  // highlight the file whose card is at the top of the scroll area
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return undefined
    let frame = 0
    const update = (): void => {
      frame = 0
      const cards = container.querySelectorAll<HTMLElement>('[data-diff-path]')
      let active: string | null = cards[0]?.dataset.diffPath ?? null
      for (const card of cards) {
        if (card.offsetTop - container.scrollTop > ACTIVE_OFFSET) break
        active = card.dataset.diffPath ?? active
      }
      if (active !== useDiffStore.getState().activePath) {
        useDiffStore.getState().setActivePath(active)
      }
    }
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  // menu commands that make sense here: Find (in the focused side), and
  // Close Tab closes the window — a diff window is its own single "tab"
  useEffect(
    () =>
      window.api.onMenuCommand((command) => {
        if (command === 'find') {
          const view = lastFocusedDiffEditor()
          if (view) openSearchPanel(view)
        } else if (command === 'close-tab') {
          window.close()
        }
      }),
    []
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, .cm-panels')) return
      const state = useDiffStore.getState()
      const list = state.summary ? filteredFiles(state.summary.files, state.filter) : []
      const index = list.findIndex((f) => f.path === state.activePath)
      if (e.key === 'j' || e.key === 'k') {
        const next = list[clamp(index + (e.key === 'j' ? 1 : -1), 0, list.length - 1)]
        if (next) scrollToFile(next.path)
      } else if (e.key === 'v' && state.activePath) {
        state.toggleViewed(state.activePath)
      } else if (e.key === 'r') {
        void state.refresh()
      } else {
        return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [scrollToFile])

  const totals = summary?.files.reduce(
    (acc, f) => ({ add: acc.add + (f.additions ?? 0), del: acc.del + (f.deletions ?? 0) }),
    { add: 0, del: 0 }
  )

  return (
    <div className="shell-gradient isolate flex h-screen flex-col">
      <header className="drag-region flex h-11 shrink-0 items-center gap-3 pr-3 pl-20">
        <span className="shrink-0 text-body font-semibold text-fg">
          {repoPath.split('/').pop()}
        </span>
        <DiffTargetPicker />
        <div className="no-drag ml-auto flex shrink-0 items-center gap-2">
          <div title="Layout" className="flex rounded border border-edge">
            {(['split', 'unified'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={layout === option}
                onClick={() => useDiffStore.getState().setLayout(option)}
                className={`focus-ring cursor-pointer px-2.5 py-1 text-label capitalize first:rounded-l last:rounded-r ${
                  layout === option ? 'bg-selection text-fg' : 'text-fg-dim hover:text-fg'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            title="Refresh (r)"
            onClick={() => void useDiffStore.getState().refresh()}
          >
            Refresh
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 px-2 pb-2">
        <div
          style={{ width: sidebarWidth }}
          className="shrink-0 overflow-hidden rounded-md border border-edge"
        >
          <DiffSidebar onSelect={scrollToFile} />
        </div>
        <Resizer
          direction="horizontal"
          onDrag={(delta) => setSidebarWidth((w) => clamp(w + delta, 180, 600))}
        />
        <main
          ref={scrollRef}
          className="relative min-w-0 flex-1 overflow-y-auto rounded-md border border-edge bg-secondary"
        >
          {summary && (
            <div className="border-b border-edge px-4 py-3">
              <div className="flex items-baseline gap-3">
                <h1 className="min-w-0 truncate text-body font-semibold text-fg select-text">
                  {summary.title}
                </h1>
                {summary.url && (
                  <button
                    type="button"
                    onClick={() => summary.url && void window.api.openExternal(summary.url)}
                    className="focus-ring shrink-0 cursor-pointer rounded text-label text-accent hover:underline"
                  >
                    Open on GitHub ↗
                  </button>
                )}
                {status === 'loading' && (
                  <span className="shrink-0 text-label text-fg-dim">Refreshing…</span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 font-mono text-label text-fg-dim">
                {summary.subtitle && <span className="select-text">{summary.subtitle}</span>}
                <span>
                  {summary.baseLabel} → {summary.headLabel}
                </span>
                {totals && (
                  <DiffStat
                    file={{ additions: totals.add, deletions: totals.del, binary: false }}
                    compact
                  />
                )}
              </div>
            </div>
          )}

          {status === 'error' ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="max-w-xl text-chrome text-error select-text">{error}</div>
              <Button size="sm" onClick={() => void useDiffStore.getState().refresh()}>
                Try again
              </Button>
            </div>
          ) : !summary ? (
            <EmptyState center>
              {source.kind === 'pr' ? 'Fetching pull request…' : 'Loading diff…'}
            </EmptyState>
          ) : summary.files.length === 0 ? (
            <EmptyState center className="h-auto! py-16">
              Nothing to review — no changes in this comparison.
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-3 p-3">
              {files.map((file) => (
                <DiffFileCard key={file.path} file={file} layout={layout} generation={generation} />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
