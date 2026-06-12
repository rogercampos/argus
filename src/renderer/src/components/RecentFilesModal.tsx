import { useCallback, useMemo, useState } from 'react'
import { fuzzyMatch } from '../fuzzy'
import { useWorkspaceStore } from '../store'
import { FileIcon } from './FileIcon'
import { Highlighted, Modal, ModalRow } from './Modal'
import { PathTail } from './PathTail'

/** Recent Files popup (spec 05): fuzzy filter on filename, intent-based list. */
export function RecentFilesModal(): React.JSX.Element {
  const recentFiles = useWorkspaceStore((s) => s.recentFiles)
  const filePaths = useWorkspaceStore((s) => s.filePaths)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)

  const close = useCallback((): void => {
    useWorkspaceStore.setState({ openModal: null })
  }, [])

  const entries = useMemo(() => {
    const existing = recentFiles.filter((p) => p.startsWith('/') || filePaths.has(p))
    const filtered = existing
      .map((path) => {
        const name = path.split('/').pop() ?? path
        const m = fuzzyMatch(query, name)
        return m ? { path, name, indices: m.indices, score: m.score } : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    if (query) filtered.sort((a, b) => b.score - a.score)

    // Directory hints only for duplicate basenames (spec 05)
    const nameCounts = new Map<string, number>()
    for (const e of filtered) nameCounts.set(e.name, (nameCounts.get(e.name) ?? 0) + 1)
    return filtered.map((e) => ({
      ...e,
      hint: (nameCounts.get(e.name) ?? 0) > 1 ? e.path.slice(0, -(e.name.length + 1)) : null
    }))
  }, [recentFiles, filePaths, query])

  const open = useCallback(
    (path: string): void => {
      close()
      void useWorkspaceStore.getState().navigateTo(path)
    },
    [close]
  )

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => (entries.length === 0 ? 0 : (s + 1) % entries.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => (entries.length === 0 ? 0 : (s - 1 + entries.length) % entries.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const entry = entries[selected]
      if (entry) open(entry.path)
    }
  }

  return (
    <Modal id="recent-files" defaultWidth={500} defaultHeight={450} onClose={close}>
      <input
        // biome-ignore lint/a11y/noAutofocus: modals own focus by design (spec 05)
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setSelected(0)
        }}
        onKeyDown={onKeyDown}
        placeholder="Recent files…"
        className="m-2 shrink-0 rounded border border-edge bg-primary px-3 py-1.5 font-mono text-[13px] outline-none placeholder:text-fg-dim"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries.map((entry, index) => (
          <ModalRow
            key={entry.path}
            selected={index === selected}
            onClick={() => open(entry.path)}
            onActivate={() => open(entry.path)}
          >
            <FileIcon path={entry.path} />
            <span className="truncate">
              <Highlighted text={entry.name} indices={entry.indices} />
            </span>
            {entry.hint && (
              <PathTail
                text={entry.hint}
                className="ml-auto truncate pl-4 font-mono text-[11px] text-fg-dim"
              />
            )}
          </ModalRow>
        ))}
        {entries.length === 0 && (
          <div className="px-3 py-4 text-[12px] text-fg-dim">
            {query ? 'No matching recent files' : 'No recent files yet'}
          </div>
        )}
      </div>
    </Modal>
  )
}
