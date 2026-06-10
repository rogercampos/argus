import { prepareFileTreeInput } from '@pierre/trees'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { useEffect } from 'react'
import { useRepoStore } from '../store'

export function Sidebar(): React.JSX.Element {
  const paths = useRepoStore((s) => s.paths)
  const gitStatus = useRepoStore((s) => s.gitStatus)
  const loadingTree = useRepoStore((s) => s.loadingTree)
  const rootName = useRepoStore((s) => s.rootName)

  const { model } = useFileTree({
    paths: [],
    search: true,
    initialExpansion: 'closed',
    flattenEmptyDirectories: true,
    icons: 'standard',
    onSelectionChange: (selectedPaths) => {
      const path = selectedPaths[0]
      if (path && useRepoStore.getState().filePaths.has(path)) {
        void useRepoStore.getState().openFile(path)
      }
    }
  })

  useEffect(() => {
    model.resetPaths(paths, { preparedInput: prepareFileTreeInput(paths) })
  }, [model, paths])

  useEffect(() => {
    model.setGitStatus(gitStatus)
  }, [model, gitStatus])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <span className="truncate text-xs font-semibold uppercase tracking-wider text-neutral-400">
          {rootName ?? 'No folder open'}
        </span>
        {loadingTree && <span className="text-xs text-neutral-500">loading…</span>}
      </div>
      <div className="min-h-0 flex-1">
        <FileTree model={model} style={{ height: '100%' }} />
      </div>
    </div>
  )
}
