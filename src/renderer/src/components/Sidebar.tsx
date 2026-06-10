import { prepareFileTreeInput } from '@pierre/trees'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { useEffect } from 'react'
import { useWorkspaceStore } from '../store'

export function Sidebar(): React.JSX.Element {
  const paths = useWorkspaceStore((s) => s.paths)
  const gitStatus = useWorkspaceStore((s) => s.gitStatus)
  const loadingTree = useWorkspaceStore((s) => s.loadingTree)
  const rootName = useWorkspaceStore((s) => s.rootName)

  const { model } = useFileTree({
    paths: [],
    search: true,
    initialExpansion: 'closed',
    flattenEmptyDirectories: true,
    icons: 'standard',
    onSelectionChange: (selectedPaths) => {
      const path = selectedPaths[0]
      if (path && useWorkspaceStore.getState().filePaths.has(path)) {
        void useWorkspaceStore.getState().openFile(path)
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
      <div className="flex items-center justify-between px-3 py-2">
        <span className="truncate text-[11px] font-semibold tracking-wider text-fg-dim uppercase">
          {rootName ?? 'No folder open'}
        </span>
        {loadingTree && <span className="text-[11px] text-fg-dim">loading…</span>}
      </div>
      <div className="min-h-0 flex-1">
        <FileTree model={model} style={{ height: '100%' }} />
      </div>
    </div>
  )
}
