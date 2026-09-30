import { useCallback, useMemo, useState } from 'react'
import { formatAccelerator } from '../../../shared/shortcuts'
import { fuzzyMatch } from '../fuzzy'
import { activeView, useWorkspaceStore } from '../store'
import { PinGlyph } from './EditorTabs'
import { FileIcon } from './FileIcon'
import { Highlighted, Modal, ModalRow, ModalSearchInput } from './Modal'
import { PathTail } from './PathTail'
import { Button } from './ui/Button'
import { EmptyState } from './ui/EmptyState'
import { IconButton } from './ui/IconButton'

/**
 * Open Tabs list (VS Code "Show All Editors", JetBrains "Show Hidden Tabs"):
 * every open tab in strip order, fuzzy filter on the name, activate without
 * reordering, close rows in place, bulk-close from the header.
 */
export function OpenTabsModal(): React.JSX.Element {
  const tabs = useWorkspaceStore((s) => s.tabs)
  const dirtyPaths = useWorkspaceStore((s) => s.dirtyPaths)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(tabs.activeIndex)

  const close = useCallback((): void => {
    useWorkspaceStore.setState({ openModal: null })
  }, [])

  const entries = useMemo(() => {
    const matched = tabs.tabs
      .map((tab, index) => {
        const name = tab.path.split('/').pop() ?? tab.path
        const m = fuzzyMatch(query, name)
        if (!m) return null
        const dir = tab.path.slice(0, -(name.length + 1))
        return { tab, index, name, dir, indices: m.indices, score: m.score }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    if (query) matched.sort((a, b) => b.score - a.score)
    return matched
  }, [tabs.tabs, query])

  const current = Math.min(selected, Math.max(entries.length - 1, 0))

  const activate = (index: number): void => {
    close()
    void useWorkspaceStore
      .getState()
      .activateTab(index)
      .then(() => requestAnimationFrame(() => activeView()?.focus()))
  }

  const closeEntry = (index: number): void => {
    void useWorkspaceStore.getState().closeTabAt(index)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const n = entries.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(n === 0 ? 0 : (current + 1) % n)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(n === 0 ? 0 : (current - 1 + n) % n)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const entry = entries[current]
      if (entry) activate(entry.index)
    } else if (e.key === 'Backspace' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      const entry = entries[current]
      if (entry) closeEntry(entry.index)
    }
  }

  const store = useWorkspaceStore.getState
  const hasUnpinned = tabs.tabs.some((t) => !t.pinned)
  const highlighted = entries[current]

  return (
    <Modal id="open-tabs" defaultWidth={560} defaultHeight={450} onClose={close}>
      <ModalSearchInput
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setSelected(0)
        }}
        onKeyDown={onKeyDown}
        placeholder="Filter open tabs…"
      />
      <div className="flex shrink-0 items-center gap-1 border-b border-edge px-3 pb-2">
        <span className="flex-1 text-label text-fg-dim tabular-nums">
          {tabs.tabs.length} open {tabs.tabs.length === 1 ? 'tab' : 'tabs'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          title="Close every unpinned tab except the highlighted one"
          disabled={!highlighted || !tabs.tabs.some((t, i) => i !== highlighted.index && !t.pinned)}
          onClick={() => highlighted && void store().closeOthers(highlighted.index)}
        >
          Close Others
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!tabs.tabs.some((t) => !t.pinned && !dirtyPaths[t.path])}
          onClick={() => void store().closeSavedTabs()}
        >
          Close Saved
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!hasUnpinned}
          onClick={() => void store().closeAllTabs()}
        >
          Close All
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries.map((entry, i) => (
          <div key={entry.tab.path} className="group relative">
            <ModalRow
              selected={i === current}
              onClick={() => activate(entry.index)}
              onActivate={() => activate(entry.index)}
            >
              <FileIcon path={entry.tab.path} />
              <span
                className={`truncate ${entry.index === tabs.activeIndex ? 'font-semibold' : ''}`}
              >
                <Highlighted text={entry.name} indices={entry.indices} />
              </span>
              {entry.tab.pinned && <PinGlyph className="shrink-0 text-fg-dim" />}
              {dirtyPaths[entry.tab.path] && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-caret"
                  title="Unsaved changes"
                />
              )}
              {entry.dir && (
                <PathTail
                  text={entry.dir}
                  className="ml-auto truncate pl-4 font-mono text-label text-fg-dim"
                />
              )}
              <span className="w-5 shrink-0" />
            </ModalRow>
            <IconButton
              title={`Close tab (${formatAccelerator('Mod+Backspace')})`}
              onClick={() => closeEntry(entry.index)}
              className={`absolute top-1/2 right-2 size-5 -translate-y-1/2 ${
                i === current ? '' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              ×
            </IconButton>
          </div>
        ))}
        {entries.length === 0 && (
          <EmptyState>{query ? 'No matching open tabs' : 'No open tabs'}</EmptyState>
        )}
      </div>
    </Modal>
  )
}
