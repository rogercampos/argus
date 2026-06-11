import type { ContextMenuItem, ContextMenuOpenContext } from '@pierre/trees'
import { prepareFileTreeInput } from '@pierre/trees'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { useCallback, useEffect } from 'react'
import { useSearchStore } from '../searchStore'
import { activeTabPath, mergePersisted, useWorkspaceStore } from '../store'
import { makeTreeSort } from '../treeSort'

/** Mutable star set read by the sort comparator (resetPaths re-sorts). */
const starredRef = { current: new Set<string>() }

const treeSort = makeTreeSort(() => starredRef.current)

const prepare = (paths: readonly string[]): ReturnType<typeof prepareFileTreeInput> =>
  prepareFileTreeInput(paths, { flattenEmptyDirectories: true, sort: treeSort })

export function Sidebar(): React.JSX.Element {
  const paths = useWorkspaceStore((s) => s.paths)
  const gitStatus = useWorkspaceStore((s) => s.gitStatus)
  const loadingTree = useWorkspaceStore((s) => s.loadingTree)
  const rootName = useWorkspaceStore((s) => s.rootName)
  const starredFolders = useWorkspaceStore((s) => s.starredFolders)

  starredRef.current = new Set(starredFolders)

  const { model } = useFileTree({
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
      const path = selectedPaths[0]
      if (path && useWorkspaceStore.getState().filePaths.has(path)) {
        void useWorkspaceStore.getState().openFile(path)
      }
    }
  })

  useEffect(() => {
    model.resetPaths(paths, { preparedInput: prepare(paths) })
  }, [model, paths])

  useEffect(() => {
    model.setGitStatus(gitStatus)
  }, [model, gitStatus])

  // Reveal Active File (spec 07): expand ancestors, scroll, select
  const locate = useCallback((): void => {
    const path = activeTabPath()
    if (!path || path.startsWith('/')) return
    const segments = path.split('/')
    for (let i = 1; i < segments.length; i++) {
      const ancestor = segments.slice(0, i).join('/')
      const item = model.getItem(ancestor)
      if (item && 'expand' in item) (item as { expand(): void }).expand()
    }
    model.scrollToPath(path, { focus: true, offset: 'center' })
    model.getItem(path)?.select()
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
            useWorkspaceStore.setState({ starredFolders: next })
            mergePersisted({ starredFolders: next })
            // re-sort with the new stars
            starredRef.current = new Set(next)
            const { paths } = useWorkspaceStore.getState()
            model.resetPaths(paths, { preparedInput: prepare(paths) })
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
    [model]
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
