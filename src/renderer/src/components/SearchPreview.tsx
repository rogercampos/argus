import { EditorView } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import type { SearchMatch } from '../../../shared/types'
import { activeTabPath, documents, getExtensionsForPath, useWorkspaceStore } from '../store'

/**
 * Editable search preview (spec 03, flagship): a real editor view over the
 * SAME document buffer as normal tabs. Edits autosave through the document
 * manager; the main editor re-syncs via the active-doc epoch.
 */
export function SearchPreview({ match }: { match: SearchMatch | null }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const shownPathRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      // On unmount, re-sync the main editor if we previewed its document
      const path = shownPathRef.current
      viewRef.current?.destroy()
      viewRef.current = null
      if (path && path === activeTabPath()) {
        useWorkspaceStore.setState((s) => ({ activeDocEpoch: s.activeDocEpoch + 1 }))
      }
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !match) return

    let cancelled = false
    void documents.open(match.path, getExtensionsForPath(match.path)).then((doc) => {
      if (cancelled || !doc || !containerRef.current) return

      if (!viewRef.current) {
        viewRef.current = new EditorView({ parent: containerRef.current })
        if (import.meta.env.DEV) {
          const hook = (window as unknown as Record<string, unknown>).__argus as
            | Record<string, unknown>
            | undefined
          if (hook) hook.previewView = viewRef.current
        }
      }
      const view = viewRef.current

      // Sync the previous previewed doc back to the main editor if needed
      const previous = shownPathRef.current
      if (previous && previous !== match.path && previous === activeTabPath()) {
        useWorkspaceStore.setState((s) => ({ activeDocEpoch: s.activeDocEpoch + 1 }))
      }

      if (view.state !== doc.state) view.setState(doc.state)
      shownPathRef.current = match.path

      // Select/highlight the match and center it
      const lineNumber = Math.min(match.line, view.state.doc.lines)
      const line = view.state.doc.line(lineNumber)
      const sub = match.origSubmatches[0]
      const from = Math.min(line.from + (sub?.start ?? 0), line.to)
      const to = Math.min(line.from + (sub?.end ?? 0), line.to)
      view.dispatch({
        selection: { anchor: from, head: to > from ? to : from },
        effects: EditorView.scrollIntoView(from, { y: 'center' })
      })
    })

    return () => {
      cancelled = true
    }
  }, [match])

  return (
    <div className="flex h-full min-w-0 flex-col">
      {match ? (
        <>
          <div className="shrink-0 border-b border-edge px-3 py-1 font-mono text-[11px] text-fg-dim">
            {match.path}
          </div>
          <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden bg-primary" />
        </>
      ) : (
        <div className="flex h-full items-center justify-center text-[12px] text-fg-dim">
          Select a match to preview it
        </div>
      )}
    </div>
  )
}
