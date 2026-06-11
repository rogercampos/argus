import type { ContextMenuItem, ContextMenuOpenContext, FileTreeBatchOperation } from '@pierre/trees'
import { FileTree as FileTreeModel, preparePresortedFileTreeInput } from '@pierre/trees'
import { FileTree } from '@pierre/trees/react'
import { useCallback, useEffect } from 'react'
import { useSearchStore } from '../searchStore'
import { activeTabPath, mergePersisted, useWorkspaceStore } from '../store'
import { makeTreeSort, sortPathsForTree } from '../treeSort'

/** Mutable star set read by the sort comparator. */
const starredRef = { current: new Set<string>() }

/** True while locate() rewrites the selection programmatically. */
const suppressSelectionRef = { current: false }

const treeSort = makeTreeSort(() => starredRef.current)

/**
 * One tree model per window, kept alive across panel toggles: tree
 * preparation runs for seconds on ~100k-path repos, so unmounting must not
 * discard it. Reopening also preserves expansion and scroll state.
 */
let sharedModel: FileTreeModel | null = null
/** Path list the model currently displays (identity-compared). */
let appliedPaths: readonly string[] | null = null
let appliedStarKey: string | null = null
let syncGeneration = 0

/** Path-list changes small enough for batch mutations (preserves expansion). */
const MAX_BATCH_OPS = 200

let sortWorker: Worker | null = null
let sortRequestId = 0

/** Sort into tree order off the UI thread; falls back to inline sorting. */
function sortInWorker(paths: readonly string[], starred: readonly string[]): Promise<string[]> {
  try {
    sortWorker ??= new Worker(new URL('../treeSortWorker.ts', import.meta.url), { type: 'module' })
  } catch {
    return Promise.resolve(sortPathsForTree(paths, new Set(starred)))
  }
  const worker = sortWorker
  return new Promise((resolve) => {
    const id = ++sortRequestId
    const cleanup = (): void => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }
    const onMessage = (event: MessageEvent<{ id: number; sorted: string[] }>): void => {
      if (event.data.id !== id) return
      cleanup()
      resolve(event.data.sorted)
    }
    const onError = (): void => {
      cleanup()
      sortWorker = null
      resolve(sortPathsForTree(paths, new Set(starred)))
    }
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.postMessage({ id, paths, starred })
  })
}

/** Adds/removes between two path lists, or null when too many for a batch. */
function diffOps(
  prev: readonly string[],
  next: readonly string[]
): FileTreeBatchOperation[] | null {
  if (Math.abs(prev.length - next.length) > MAX_BATCH_OPS) return null
  const prevSet = new Set(prev)
  const nextSet = new Set(next)
  const ops: FileTreeBatchOperation[] = []
  for (const path of next) {
    if (!prevSet.has(path)) {
      ops.push({ type: 'add', path })
      if (ops.length > MAX_BATCH_OPS) return null
    }
  }
  for (const path of prev) {
    if (!nextSet.has(path)) {
      ops.push({ type: 'remove', path, recursive: true })
      if (ops.length > MAX_BATCH_OPS) return null
    }
  }
  return ops
}

/** Top-level directories currently expanded, to survive a full reset. */
function expandedTopLevelDirs(model: FileTreeModel, prevPaths: readonly string[]): string[] {
  const topLevel = new Set<string>()
  for (const path of prevPaths) {
    const slash = path.indexOf('/')
    if (slash > 0) topLevel.add(path.slice(0, slash))
  }
  const expanded: string[] = []
  for (const dir of topLevel) {
    const item = model.getItem(dir)
    if (item && 'isExpanded' in item && (item as { isExpanded(): boolean }).isExpanded()) {
      expanded.push(dir)
    }
  }
  return expanded
}

function workspaceModel(): FileTreeModel {
  sharedModel ??= new FileTreeModel({
    paths: [],
    search: true,
    initialExpansion: 'closed',
    flattenEmptyDirectories: true,
    icons: 'standard',
    sort: treeSort,
    renderRowDecoration: ({ row }) =>
      row.level === 1 && row.kind === 'directory' && starredRef.current.has(row.path)
        ? { text: '★', title: 'Starred' }
        : null,
    composition: { contextMenu: { enabled: true, triggerMode: 'right-click' } },
    onSelectionChange: (selectedPaths) => {
      if (suppressSelectionRef.current) return
      const path = selectedPaths[0]
      if (path && useWorkspaceStore.getState().filePaths.has(path)) {
        void useWorkspaceStore.getState().openFile(path)
      }
    }
  })
  return sharedModel
}

/**
 * Bring the model in line with the store's path list, as cheaply as possible:
 * no-op when nothing changed; batch mutations for small diffs (watcher
 * relists — preserves expansion); otherwise a full rebuild through the
 * worker sort + the library's presorted fast path. Passing only
 * preparedInput to resetPaths matters: passing paths too makes the library
 * re-sort the whole list again just to validate they match.
 */
function syncModelPaths(model: FileTreeModel, paths: readonly string[], starKey: string): void {
  if (appliedPaths === paths && appliedStarKey === starKey) return
  const generation = ++syncGeneration

  if (appliedPaths !== null && appliedStarKey === starKey) {
    const ops = diffOps(appliedPaths, paths)
    if (ops) {
      try {
        if (ops.length > 0) model.batch(ops)
        appliedPaths = paths
        return
      } catch {
        // model/list drift: fall through to the full rebuild
      }
    }
  }

  void sortInWorker(paths, [...starredRef.current]).then((sorted) => {
    if (generation !== syncGeneration) return // superseded
    const initialExpandedPaths = expandedTopLevelDirs(model, appliedPaths ?? [])
    model.resetPaths(null as unknown as readonly string[], {
      preparedInput: preparePresortedFileTreeInput(sorted),
      initialExpandedPaths
    })
    appliedPaths = paths
    appliedStarKey = starKey
  })
}

export function Sidebar(): React.JSX.Element {
  const paths = useWorkspaceStore((s) => s.paths)
  const gitStatus = useWorkspaceStore((s) => s.gitStatus)
  const loadingTree = useWorkspaceStore((s) => s.loadingTree)
  const rootName = useWorkspaceStore((s) => s.rootName)
  const starredFolders = useWorkspaceStore((s) => s.starredFolders)

  starredRef.current = new Set(starredFolders)
  const starKey = starredFolders.join('\n')

  const model = workspaceModel()

  useEffect(() => {
    syncModelPaths(model, paths, starKey)
  }, [model, paths, starKey])

  useEffect(() => {
    model.setGitStatus(gitStatus)
  }, [model, gitStatus])

  // Reveal Active File (spec 07): expand ancestors, scroll, select.
  // The previous selection is cleared first; selection-change events are
  // suppressed so the cleanup doesn't re-open previously selected files.
  const locate = useCallback((): void => {
    const path = activeTabPath()
    if (!path || path.startsWith('/')) return
    suppressSelectionRef.current = true
    try {
      for (const selected of model.getSelectedPaths()) {
        if (selected !== path) model.getItem(selected)?.deselect()
      }
      const segments = path.split('/')
      for (let i = 1; i < segments.length; i++) {
        const ancestor = segments.slice(0, i).join('/')
        const item = model.getItem(ancestor)
        if (item && 'expand' in item) (item as { expand(): void }).expand()
      }
      model.scrollToPath(path, { focus: true, offset: 'center' })
      model.getItem(path)?.select()
    } finally {
      suppressSelectionRef.current = false
    }
  }, [model])

  useEffect(() => {
    return window.api.onMenuCommand((command) => {
      if (command === 'reveal-active-file') locate()
    })
  }, [locate])


  const renderContextMenu = useCallback(
    (item: ContextMenuItem, context: ContextMenuOpenContext) => {
      const state = useWorkspaceStore.getState()
      // directory paths arrive with a trailing slash from @pierre/trees
      const path = item.path.replace(/\/+$/, '')
      const isFirstLevelDir = item.kind === 'directory' && !path.includes('/')
      const starred = state.starredFolders.includes(path)
      const excluded = state.excludedPaths.includes(path)
      const root = state.rootPath ?? ''

      const entries: Array<[string, () => void]> = []
      if (item.kind === 'directory') {
        entries.push([
          'Find in Folder…',
          () => {
            useSearchStore.getState().openModal(false)
            useSearchStore.getState().setModalScope(path)
          }
        ])
      }
      entries.push(
        ['Copy Path', () => void window.api.copyToClipboard(`${root}/${path}`)],
        ['Copy Relative Path', () => void window.api.copyToClipboard(path)],
        ['Reveal in Finder', () => void window.api.revealInFinder(path)]
      )
      if (isFirstLevelDir) {
        entries.push([
          starred ? 'Unstar' : 'Star',
          () => {
            const next = starred
              ? state.starredFolders.filter((p) => p !== path)
              : [...state.starredFolders, path]
            // starKey change re-sorts via the syncModelPaths effect
            useWorkspaceStore.setState({ starredFolders: next })
            mergePersisted({ starredFolders: next })
          }
        ])
      }
      entries.push([
        excluded ? 'Remove from Excluded Paths' : 'Exclude from Project',
        () => {
          const next = excluded
            ? state.excludedPaths.filter((p) => p !== path)
            : [...state.excludedPaths, path]
          useWorkspaceStore.setState({ excludedPaths: next })
          mergePersisted({ excludedPaths: next })
        }
      ])

      return (
        <div className="min-w-44 rounded-md border border-edge bg-secondary py-1 font-ui shadow-[0_8px_30px_rgba(0,0,0,.4)]">
          {entries.map(([label, action]) => (
            <button
              type="button"
              key={label}
              onClick={() => {
                context.close()
                action()
              }}
              className="block w-full cursor-pointer px-3 py-1 text-left text-[12px] text-fg hover:bg-hover"
            >
              {label}
            </button>
          ))}
        </div>
      )
    },
    []
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="truncate text-[11px] font-semibold tracking-wider text-fg-dim uppercase">
          {rootName ?? 'No folder open'}
        </span>
        <div className="flex items-center gap-1">
          {loadingTree && <span className="text-[11px] text-fg-dim">loading…</span>}
          <button
            type="button"
            title="Reveal active file"
            onClick={locate}
            className="cursor-pointer rounded px-1 text-[12px] text-fg-dim hover:bg-hover hover:text-fg"
          >
            ◎
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <FileTree model={model} style={{ height: '100%' }} renderContextMenu={renderContextMenu} />
      </div>
    </div>
  )
}
