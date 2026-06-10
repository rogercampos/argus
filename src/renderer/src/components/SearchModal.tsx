import { useCallback, useMemo, useRef, useState } from 'react'
import type { SearchMatch } from '../../../shared/types'
import { useSearchStore } from '../searchStore'
import { documents, getExtensionsForPath, useWorkspaceStore } from '../store'
import { Modal } from './Modal'
import { SearchPreview } from './SearchPreview'

/** Toggle button for case / word / regex flags. */
export function FlagToggle({
  label,
  title,
  active,
  onToggle
}: {
  label: string
  title: string
  active: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onToggle}
      className={`cursor-pointer rounded px-1.5 py-0.5 font-mono text-[11px] ${
        active ? 'bg-caret/30 text-accent' : 'text-fg-dim hover:bg-hover'
      }`}
    >
      {label}
    </button>
  )
}

/** Scope row: "Folder: All files" with a filterable directory picker. */
export function ScopeRow({
  scope,
  onScope
}: {
  scope: string | null
  onScope: (scope: string | null) => void
}): React.JSX.Element {
  const [picking, setPicking] = useState(false)
  const [filter, setFilter] = useState('')
  const paths = useWorkspaceStore((s) => s.paths)

  const directories = useMemo(() => {
    if (!picking) return []
    const dirs = new Set<string>()
    for (const p of paths) {
      let slash = p.indexOf('/')
      while (slash !== -1) {
        dirs.add(p.slice(0, slash))
        slash = p.indexOf('/', slash + 1)
      }
    }
    const list = [...dirs].sort()
    const f = filter.toLowerCase()
    return (f ? list.filter((d) => d.toLowerCase().includes(f)) : list).slice(0, 50)
  }, [picking, paths, filter])

  return (
    <div className="relative flex shrink-0 items-center gap-2 border-b border-edge px-3 py-1 text-[11px]">
      <button
        type="button"
        onClick={() => setPicking(!picking)}
        className="cursor-pointer text-fg-dim hover:text-fg"
      >
        Folder: <span className="text-accent">{scope ?? 'All files'}</span>
      </button>
      {scope && (
        <button
          type="button"
          onClick={() => onScope(null)}
          className="cursor-pointer text-fg-dim hover:text-fg"
        >
          ✕
        </button>
      )}
      {picking && (
        <div className="absolute top-full left-2 z-50 mt-1 w-96 rounded-md border border-edge bg-secondary p-1 shadow-[0_8px_30px_rgba(0,0,0,.4)]">
          <input
            // biome-ignore lint/a11y/noAutofocus: transient picker
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setPicking(false)
              }
              if (e.key === 'Enter' && directories[0]) {
                onScope(directories[0])
                setPicking(false)
              }
            }}
            placeholder="Filter folders…"
            className="mb-1 w-full rounded border border-edge bg-primary px-2 py-1 font-mono text-[11px] outline-none"
          />
          <div className="max-h-48 overflow-y-auto">
            {directories.map((dir) => (
              <button
                type="button"
                key={dir}
                onClick={() => {
                  onScope(dir)
                  setPicking(false)
                }}
                className="block w-full cursor-pointer truncate rounded px-2 py-0.5 text-left font-mono text-[11px] hover:bg-hover"
              >
                {dir}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** One result row: highlighted line text + dimmed location. */
function ResultRow({
  match,
  selected,
  onSelect,
  onOpen
}: {
  match: SearchMatch
  selected: boolean
  onSelect: () => void
  onOpen: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  const name = match.path.split('/').pop()
  const sub = match.submatches[0]
  return (
    <button
      type="button"
      ref={ref}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={`flex h-[26px] w-full shrink-0 cursor-pointer items-center gap-2 px-3 text-left ${
        selected ? 'bg-selection' : 'hover:bg-hover'
      }`}
    >
      <span className="truncate font-mono text-[11px]">
        {sub ? (
          <>
            {match.text.slice(0, sub.start)}
            <span className="rounded-sm bg-warning/30 text-warning">
              {match.text.slice(sub.start, sub.end)}
            </span>
            {match.text.slice(sub.end)}
          </>
        ) : (
          match.text
        )}
      </span>
      <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-dim">
        {name}:{match.line}
      </span>
    </button>
  )
}

/** Global search / replace modal (spec 03). */
export function SearchModal(): React.JSX.Element {
  const s = useSearchStore()
  const inputRef = useRef<HTMLInputElement>(null)

  const close = useCallback(() => useSearchStore.getState().closeModal(), [])

  const openMatch = useCallback(
    (match: SearchMatch): void => {
      close()
      void useWorkspaceStore.getState().navigateTo(match.path, { line: match.line })
    },
    [close]
  )

  const selectedMatch: SearchMatch | null = s.modalResults.matches[s.modalSelected] ?? null

  /** Replace the selected match through the shared document buffer (spec 03). */
  const replaceSelected = useCallback(async (): Promise<void> => {
    const state = useSearchStore.getState()
    const match = state.modalResults.matches[state.modalSelected]
    if (!match) return
    const doc = await documents.open(match.path, getExtensionsForPath(match.path))
    if (!doc) return
    const lineNumber = Math.min(match.line, doc.state.doc.lines)
    const line = doc.state.doc.line(lineNumber)
    const sub = match.origSubmatches[0]
    const displaySub = match.submatches[0]
    if (!sub || !displaySub) return
    const from = line.from + sub.start
    const to = Math.min(line.from + sub.end, line.to)
    // re-verify against the text the user saw before replacing (file may have changed)
    const expected = match.text.slice(displaySub.start, displaySub.end)
    if (doc.state.sliceDoc(from, to) !== expected) return
    const newState = doc.state.update({
      changes: { from, to, insert: state.replaceText }
    }).state
    documents.noteViewUpdate(match.path, newState, true)
    // drop the match from the list and keep the selection position
    const matches = state.modalResults.matches.filter((_, i) => i !== state.modalSelected)
    useSearchStore.setState({
      modalResults: { ...state.modalResults, matches, total: state.modalResults.total - 1 },
      modalSelected: Math.min(state.modalSelected, Math.max(0, matches.length - 1))
    })
  }, [])

  const [replaceAllStatus, setReplaceAllStatus] = useState<string | null>(null)
  const runReplaceAll = useCallback(async (): Promise<void> => {
    const state = useSearchStore.getState()
    setReplaceAllStatus('Replacing…')
    const result = await window.api.replaceAll(
      {
        pattern: state.modalPattern,
        caseSensitive: state.flags.caseSensitive,
        wholeWord: state.flags.wholeWord,
        regex: state.flags.regex,
        scopeFolder: state.modalScope,
        excludedPaths: useWorkspaceStore.getState().excludedPaths
      },
      state.replaceText
    )
    setReplaceAllStatus(
      `Replaced ${result.replacements} occurrences in ${result.filesChanged} files`
    )
    state.runModalSearch(state.modalPattern)
  }, [])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const matches = s.modalResults.matches
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      useSearchStore.setState({
        modalSelected: matches.length === 0 ? 0 : (s.modalSelected + 1) % matches.length
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      useSearchStore.setState({
        modalSelected:
          matches.length === 0 ? 0 : (s.modalSelected - 1 + matches.length) % matches.length
      })
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (s.modalPattern) useSearchStore.getState().openInPanel()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (s.replaceMode && s.replaceText) void replaceSelected()
      else if (selectedMatch) openMatch(selectedMatch)
    }
  }

  return (
    <Modal id="global-search" defaultWidth={1100} defaultHeight={600} onClose={close}>
      <div className="flex shrink-0 items-center gap-1 border-b border-edge p-2">
        <input
          ref={inputRef}
          // biome-ignore lint/a11y/noAutofocus: modals own focus (spec 05)
          autoFocus
          value={s.modalPattern}
          onChange={(e) => useSearchStore.getState().runModalSearch(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={onKeyDown}
          placeholder="Search in all files…"
          className="min-w-0 flex-1 rounded border border-edge bg-primary px-3 py-1.5 font-mono text-[13px] outline-none placeholder:text-fg-dim"
        />
        <FlagToggle
          label="Aa"
          title="Case sensitive"
          active={s.flags.caseSensitive}
          onToggle={() => s.setFlags({ caseSensitive: !s.flags.caseSensitive })}
        />
        <FlagToggle
          label="W"
          title="Whole word"
          active={s.flags.wholeWord}
          onToggle={() => s.setFlags({ wholeWord: !s.flags.wholeWord })}
        />
        <FlagToggle
          label=".*"
          title="Regex"
          active={s.flags.regex}
          onToggle={() => s.setFlags({ regex: !s.flags.regex })}
        />
      </div>

      {s.replaceMode && (
        <div className="flex shrink-0 items-center gap-2 border-b border-edge p-2">
          <input
            value={s.replaceText}
            onChange={(e) => useSearchStore.getState().setReplaceText(e.target.value)}
            placeholder="Replace with…"
            className="min-w-0 flex-1 rounded border border-edge bg-primary px-3 py-1.5 font-mono text-[13px] outline-none placeholder:text-fg-dim"
          />
          <button
            type="button"
            onClick={() => void replaceSelected()}
            className="cursor-pointer rounded border border-edge px-3 py-1 text-[11px] hover:bg-hover"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={() => void runReplaceAll()}
            className="cursor-pointer rounded bg-button-primary px-3 py-1 text-[11px] font-medium text-black hover:opacity-90"
          >
            Replace All
          </button>
        </div>
      )}

      <ScopeRow scope={s.modalScope} onScope={(scope) => s.setModalScope(scope)} />

      <div className="flex min-h-0 flex-1">
        <div className="flex w-1/2 flex-col overflow-y-auto border-r border-edge">
          {s.modalResults.matches.map((match, index) => (
            <ResultRow
              key={`${match.path}:${match.line}:${match.origSubmatches[0]?.start ?? index}`}
              match={match}
              selected={index === s.modalSelected}
              onSelect={() => useSearchStore.setState({ modalSelected: index })}
              onOpen={() => openMatch(match)}
            />
          ))}
          {s.modalResults.matches.length === 0 && s.modalPattern && !s.modalResults.running && (
            <div className="px-3 py-4 text-[12px] text-fg-dim">No results</div>
          )}
        </div>
        <div className="w-1/2">
          <SearchPreview match={selectedMatch} />
        </div>
      </div>

      <div className="flex shrink-0 items-center border-t border-edge px-3 py-1.5 text-[11px] text-fg-dim">
        <span>
          {replaceAllStatus ??
            (s.modalResults.running
              ? `Found ${s.modalResults.total} results so far…`
              : s.modalResults.capped
                ? `Showing first ${s.modalResults.total} — refine your search`
                : `Found ${s.modalResults.total} results`)}
        </span>
        <button
          type="button"
          onClick={() => s.modalPattern && useSearchStore.getState().openInPanel()}
          className="ml-auto cursor-pointer rounded border border-edge px-2 py-0.5 hover:bg-hover"
        >
          Open in Search Panel ⌘⏎
        </button>
      </div>
    </Modal>
  )
}
