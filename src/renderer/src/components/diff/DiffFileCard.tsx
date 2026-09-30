import { memo, useEffect, useRef, useState } from 'react'
import type { DiffFileContent, DiffFileEntry } from '../../../../shared/types'
import { createDiffView, type DiffLayout } from '../../diffEditor'
import { startsCollapsed, useDiffStore } from '../../diffStore'
import { FileIcon } from '../FileIcon'
import { DiffStat, StatusBadge } from './diffBits'

/**
 * One changed file: a sticky header (status, path, counts, viewed toggle)
 * over a read-only diff view. Contents are fetched and the editor mounted
 * only once the card scrolls near the viewport, so a 500-file PR opens as
 * fast as a 5-file one; once mounted a card stays mounted.
 */

type Body =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; oldText: string | null; newText: string | null }
  | { kind: 'message'; text: string }

/** How far outside the viewport a card starts loading. */
const PRELOAD_MARGIN = '1200px 0px'
const LINE_HEIGHT = 19.5

function estimateHeight(file: DiffFileEntry): number {
  const lines = (file.additions ?? 0) + (file.deletions ?? 0)
  // changed lines plus folded context; a rough guess keeps the scrollbar sane
  return Math.min(900, 40 + Math.max(4, lines + 6) * LINE_HEIGHT)
}

function describe(content: DiffFileContent): string | null {
  switch (content.kind) {
    case 'binary':
      return 'Binary file not shown'
    case 'too-large':
      return 'File too large to display (over 5 MB)'
    case 'error':
      return `Couldn't read file: ${content.message}`
    default:
      return null
  }
}

async function loadBody(file: DiffFileEntry): Promise<Body> {
  const [oldSide, newSide] = await Promise.all([
    file.status === 'added'
      ? Promise.resolve<DiffFileContent>({ kind: 'absent' })
      : window.api.readDiffFile('old', file.oldPath ?? file.path),
    file.status === 'deleted'
      ? Promise.resolve<DiffFileContent>({ kind: 'absent' })
      : window.api.readDiffFile('new', file.path)
  ])
  const problem = describe(oldSide) ?? describe(newSide)
  if (problem) return { kind: 'message', text: problem }
  const oldText = oldSide.kind === 'text' ? oldSide.text : null
  const newText = newSide.kind === 'text' ? newSide.text : null
  if (oldText !== null && oldText === newText) {
    return {
      kind: 'message',
      text: file.status === 'renamed' ? 'File renamed without changes' : 'No content changes'
    }
  }
  return { kind: 'ready', oldText, newText }
}

export const DiffFileCard = memo(function DiffFileCard({
  file,
  layout,
  generation
}: {
  file: DiffFileEntry
  layout: DiffLayout
  generation: number
}): React.JSX.Element {
  const collapsed = useDiffStore((s) => s.collapsed.has(file.path))
  const viewed = useDiffStore((s) => s.viewed.has(file.path))
  const setCollapsed = useDiffStore((s) => s.setCollapsed)
  const toggleViewed = useDiffStore((s) => s.toggleViewed)

  const cardRef = useRef<HTMLElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [body, setBody] = useState<Body>({ kind: 'idle' })

  useEffect(() => {
    const card = cardRef.current
    if (!card || near) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true)
      },
      { rootMargin: PRELOAD_MARGIN }
    )
    observer.observe(card)
    return () => observer.disconnect()
  }, [near])

  // (re)fetch when first needed and after every reload of the comparison
  // biome-ignore lint/correctness/useExhaustiveDependencies: generation is the refetch trigger
  useEffect(() => {
    if (!near || collapsed || file.binary) return undefined
    let cancelled = false
    setBody({ kind: 'loading' })
    void loadBody(file).then((next) => {
      if (!cancelled) setBody(next)
    })
    return () => {
      cancelled = true
    }
  }, [near, collapsed, file, generation])

  useEffect(() => {
    const parent = editorRef.current
    if (!parent || body.kind !== 'ready' || collapsed) return undefined
    const handle = createDiffView({
      parent,
      layout,
      oldText: body.oldText,
      newText: body.newText,
      oldPath: file.oldPath ?? file.path,
      newPath: file.path
    })
    return () => handle.destroy()
  }, [body, layout, collapsed, file])

  const lines = (file.additions ?? 0) + (file.deletions ?? 0)
  const slash = file.path.lastIndexOf('/')

  return (
    <section
      ref={cardRef}
      data-diff-path={file.path}
      className="overflow-clip rounded-md border border-edge bg-primary"
    >
      <header className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-edge bg-secondary px-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${file.path}` : `Collapse ${file.path}`}
          onClick={() => setCollapsed(file.path, !collapsed)}
          className="focus-ring flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded text-left"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            aria-hidden="true"
            className={`shrink-0 text-fg-dim transition-transform ${collapsed ? '' : 'rotate-90'}`}
          >
            <path d="M3 1.5 7 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <StatusBadge status={file.status} />
          <FileIcon path={file.path} />
          <span className="min-w-0 truncate font-mono text-chrome">
            {file.oldPath && (
              <span className="text-fg-dim">
                {file.oldPath}
                {' → '}
              </span>
            )}
            <span className="text-fg-dim">{file.path.slice(0, slash + 1)}</span>
            <span className={viewed ? 'text-fg-dim' : 'text-fg'}>{file.path.slice(slash + 1)}</span>
          </span>
        </button>
        <DiffStat file={file} />
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-label text-fg-dim hover:bg-hover hover:text-fg">
          <input
            type="checkbox"
            checked={viewed}
            onChange={() => toggleViewed(file.path)}
            className="accent-accent"
          />
          Viewed
        </label>
      </header>

      {!collapsed &&
        (file.binary ? (
          <Notice>Binary file not shown</Notice>
        ) : body.kind === 'message' ? (
          <Notice>{body.text}</Notice>
        ) : body.kind === 'ready' ? (
          <div ref={editorRef} className="diff-body" />
        ) : (
          <div style={{ height: estimateHeight(file) }} />
        ))}

      {collapsed && !viewed && startsCollapsed(file) && (
        <Notice>
          {lines > 0
            ? `Large or generated diff (${lines.toLocaleString()} lines)`
            : 'Generated file'}{' '}
          hidden.{' '}
          <button
            type="button"
            onClick={() => setCollapsed(file.path, false)}
            className="focus-ring cursor-pointer rounded text-accent hover:underline"
          >
            Load diff
          </button>
        </Notice>
      )}
    </section>
  )
})

function Notice({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="px-4 py-3 text-chrome text-fg-dim">{children}</div>
}
