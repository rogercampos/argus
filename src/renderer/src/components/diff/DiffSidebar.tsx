import { useMemo } from 'react'
import type { DiffFileEntry } from '../../../../shared/types'
import { filteredFiles, useDiffStore } from '../../diffStore'
import { EmptyState } from '../ui/EmptyState'
import { TextInput } from '../ui/TextInput'
import { DiffStat, StatusBadge } from './diffBits'

/**
 * Changed files grouped by directory. Clicking scrolls the file into view;
 * the row for the file at the top of the diff area stays highlighted.
 */

interface Group {
  dir: string
  files: DiffFileEntry[]
}

function groupByDirectory(files: DiffFileEntry[]): Group[] {
  const groups: Group[] = []
  for (const file of files) {
    const slash = file.path.lastIndexOf('/')
    const dir = slash === -1 ? '' : file.path.slice(0, slash)
    const last = groups[groups.length - 1]
    if (last && last.dir === dir) last.files.push(file)
    else groups.push({ dir, files: [file] })
  }
  return groups
}

export function DiffSidebar({ onSelect }: { onSelect: (path: string) => void }): React.JSX.Element {
  const summary = useDiffStore((s) => s.summary)
  const filter = useDiffStore((s) => s.filter)
  const setFilter = useDiffStore((s) => s.setFilter)
  const activePath = useDiffStore((s) => s.activePath)
  const viewed = useDiffStore((s) => s.viewed)

  const files = summary?.files ?? []
  const groups = useMemo(() => groupByDirectory(filteredFiles(files, filter)), [files, filter])

  return (
    <aside className="flex h-full flex-col bg-secondary">
      <div className="flex shrink-0 items-baseline justify-between px-3 pt-3 pb-2">
        <span className="text-chrome text-fg">
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
        <span className="text-label text-fg-dim">
          {viewed.size}/{files.length} viewed
        </span>
      </div>
      <div className="shrink-0 px-2 pb-2">
        <TextInput
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files"
          className="w-full py-1 text-chrome"
        />
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto pb-2">
        {groups.length === 0 && (
          <EmptyState>{files.length === 0 ? 'No changes' : 'No matching files'}</EmptyState>
        )}
        {groups.map((group) => (
          <div key={group.dir}>
            {group.dir && (
              <div className="truncate px-3 pt-2 pb-0.5 font-mono text-label text-fg-dim">
                {group.dir}/
              </div>
            )}
            {group.files.map((file) => {
              const name = file.path.slice(file.path.lastIndexOf('/') + 1)
              const active = file.path === activePath
              const isViewed = viewed.has(file.path)
              return (
                <button
                  key={file.path}
                  type="button"
                  title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                  onClick={() => onSelect(file.path)}
                  className={`focus-ring -outline-offset-2 flex h-(--size-row) w-full cursor-pointer items-center gap-2 pr-2 pl-4 text-left ${
                    active ? 'bg-selection' : 'hover:bg-hover'
                  }`}
                >
                  <StatusBadge status={file.status} />
                  <span
                    className={`min-w-0 flex-1 truncate font-mono text-chrome ${
                      isViewed ? 'text-fg-dim line-through decoration-fg-dim/50' : 'text-fg'
                    }`}
                  >
                    {name}
                  </span>
                  <DiffStat file={file} compact />
                </button>
              )
            })}
          </div>
        ))}
      </nav>
    </aside>
  )
}
