import { useCallback, useEffect, useRef, useState } from 'react'
import type { RankedItem } from '../fuzzy'
import { useWorkspaceStore } from '../store'
import { FileIcon } from './FileIcon'
import { Highlighted, Modal, ModalRow } from './Modal'

/** Workspace paths minus excluded prefixes (spec 07). */
function visiblePaths(): string[] {
  const { paths, excludedPaths } = useWorkspaceStore.getState()
  if (excludedPaths.length === 0) return paths
  const prefixes = excludedPaths.map((p) => `${p}/`)
  return paths.filter((path) => !prefixes.some((prefix) => path.startsWith(prefix)))
}

const LIMIT = 200

/** Go to File (spec 04): worker-filtered fuzzy search over all paths. */
export function GoToFileModal(): React.JSX.Element {
  const lastQuery = useWorkspaceStore.getState().lastGoToFileQuery
  const [query, setQuery] = useState(lastQuery)
  const [items, setItems] = useState<RankedItem[]>([])
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const queryIdRef = useRef(0)

  const close = useCallback((): void => {
    useWorkspaceStore.setState({
      openModal: null,
      lastGoToFileQuery: inputRef.current?.value ?? ''
    })
  }, [])

  // Worker lifecycle + initial query
  useEffect(() => {
    const worker = new Worker(new URL('../fuzzyWorker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.postMessage({ type: 'set', paths: visiblePaths() })
    worker.onmessage = (
      event: MessageEvent<{ type: string; id: number; items: RankedItem[]; total: number }>
    ) => {
      if (event.data.id !== queryIdRef.current) return // stale
      setItems(event.data.items)
      setTotal(event.data.total)
      setSelected(0)
    }
    return () => worker.terminate()
  }, [])

  const runQuery = useCallback(async (value: string): Promise<void> => {
    // Absolute path queries (spec 04)
    const home = '~'
    if (value.startsWith('/') || value.startsWith(`${home}/`) || value === home) {
      const root = useWorkspaceStore.getState().rootPath ?? ''
      const expanded = value.startsWith(home)
        ? value.replace(home, root.split('/').slice(0, 3).join('/'))
        : value
      if (expanded.startsWith(`${root}/`)) {
        // inside the workspace: match the relative path
        const rel = expanded.slice(root.length + 1)
        queryIdRef.current += 1
        workerRef.current?.postMessage({
          type: 'query',
          id: queryIdRef.current,
          query: rel,
          recents: [],
          limit: LIMIT
        })
        return
      }
      // outside the workspace: offer the exact file if it exists
      queryIdRef.current += 1
      const exists = await window.api.fileExists(expanded)
      setItems(exists ? [{ path: expanded, score: 0, indices: [] }] : [])
      setTotal(exists ? 1 : 0)
      setSelected(0)
      return
    }

    queryIdRef.current += 1
    workerRef.current?.postMessage({
      type: 'query',
      id: queryIdRef.current,
      query: value,
      recents: useWorkspaceStore.getState().recentFiles,
      limit: LIMIT
    })
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount with the restored query
  useEffect(() => {
    void runQuery(query)
  }, [])

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
      setSelected((s) => (items.length === 0 ? 0 : (s + 1) % items.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => (items.length === 0 ? 0 : (s - 1 + items.length) % items.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[selected]
      if (item) open(item.path)
    }
  }

  return (
    <Modal id="go-to-file" defaultWidth={800} defaultHeight={520} onClose={close}>
      <input
        ref={inputRef}
        // biome-ignore lint/a11y/noAutofocus: modals own focus by design (spec 05)
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          void runQuery(e.target.value)
        }}
        onFocus={(e) => e.target.select()}
        onKeyDown={onKeyDown}
        placeholder="Type a file name or path…"
        className="m-2 shrink-0 rounded border border-edge bg-primary px-3 py-1.5 font-mono text-[13px] outline-none placeholder:text-fg-dim"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.map((item, index) => {
          const slash = item.path.lastIndexOf('/')
          const name = item.path.slice(slash + 1)
          const dir = slash === -1 ? '' : item.path.slice(0, slash)
          const nameIndices = item.indices.filter((i) => i > slash).map((i) => i - slash - 1)
          return (
            <ModalRow
              key={item.path}
              selected={index === selected}
              onClick={() => open(item.path)}
              onActivate={() => open(item.path)}
            >
              <FileIcon path={item.path} />
              <span className="truncate">
                <Highlighted text={name} indices={nameIndices} />
              </span>
              <span className="ml-auto truncate pl-4 font-mono text-[11px] text-fg-dim">{dir}</span>
            </ModalRow>
          )
        })}
        {items.length === 0 && query && (
          <div className="px-3 py-4 text-[12px] text-fg-dim">No matching files</div>
        )}
      </div>
      {total > LIMIT && (
        <div className="shrink-0 border-t border-edge px-3 py-1 text-[11px] text-fg-dim">
          Showing first {LIMIT} results — refine your search for more
        </div>
      )}
    </Modal>
  )
}
