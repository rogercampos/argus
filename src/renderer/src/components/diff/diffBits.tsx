import type { DiffFileEntry, DiffFileStatus } from '../../../../shared/types'

/** Small shared pieces of the diff window: status letters and +/− counts. */

const STATUS: Record<DiffFileStatus, { letter: string; className: string; label: string }> = {
  added: { letter: 'A', className: 'text-git-added', label: 'Added' },
  modified: { letter: 'M', className: 'text-git-modified', label: 'Modified' },
  deleted: { letter: 'D', className: 'text-git-deleted', label: 'Deleted' },
  renamed: { letter: 'R', className: 'text-purplex', label: 'Renamed' }
}

export function StatusBadge({ status }: { status: DiffFileStatus }): React.JSX.Element {
  const { letter, className, label } = STATUS[status]
  return (
    <span
      title={label}
      className={`w-3 shrink-0 text-center font-mono text-label font-bold ${className}`}
    >
      {letter}
    </span>
  )
}

export function DiffStat({
  file,
  compact = false
}: {
  file: Pick<DiffFileEntry, 'additions' | 'deletions' | 'binary'>
  compact?: boolean
}): React.JSX.Element {
  if (file.binary) {
    return <span className="shrink-0 text-label text-fg-dim">binary</span>
  }
  return (
    <span className={`flex shrink-0 gap-1.5 font-mono text-label ${compact ? '' : 'px-1'}`}>
      {(file.additions ?? 0) > 0 && <span className="text-git-added">+{file.additions}</span>}
      {(file.deletions ?? 0) > 0 && <span className="text-git-deleted">−{file.deletions}</span>}
    </span>
  )
}
