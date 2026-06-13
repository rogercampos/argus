import { useCallback, useEffect, useRef, useState } from 'react'
import type { RankedItem } from '../fuzzy'
import { useWorkspaceStore } from '../store'
import { FileIcon } from './FileIcon'
import { Highlighted, Modal, ModalRow, ModalSearchInput } from './Modal'
import { PathTail } from './PathTail'
import { EmptyState } from './ui/EmptyState'

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

  // Worker lifecycle
  useEffect(() => {
    const worker = new Worker(new URL('../fuzzyWorker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
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
      const homeDir = window.api.windowInit.homeDir
      const expanded = value.startsWith(home) ? homeDir + value.slice(home.length) : value
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

  // Feed the worker whenever the path list changes: the modal can open while
  // the full file list is still loading (startup shows the top-level skeleton
  // only), and results must reflect the complete list once it lands.
  const paths = useWorkspaceStore((s) => s.paths)
  const excludedPaths = useWorkspaceStore((s) => s.excludedPaths)
  // biome-ignore lint/correctness/useExhaustiveDependencies: excludedPaths is read indirectly via visiblePaths(); it must re-feed the worker when exclusions change
  useEffect(() => {
    workerRef.current?.postMessage({ type: 'set', paths: visiblePaths() })
    void runQuery(inputRef.current?.value ?? '')
  }, [paths, excludedPaths, runQuery])

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
      <ModalSearchInput
        inputRef={inputRef}
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          void runQuery(e.target.value)
        }}
        onFocus={(e) => e.target.select()}
        onKeyDown={onKeyDown}
        placeholder="Type a file name or path…"
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
              <PathTail
                text={dir}
                className="ml-auto truncate pl-4 font-mono text-label text-fg-dim"
              />
            </ModalRow>
          )
        })}
        {items.length === 0 && query && <EmptyState>No matching files</EmptyState>}
      </div>
      {total > LIMIT && (
        <div className="shrink-0 border-t border-edge px-3 py-1 text-label text-fg-dim">
          Showing first {LIMIT} results — refine your search for more
        </div>
      )}
    </Modal>
  )
}
