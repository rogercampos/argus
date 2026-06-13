import { highlightSelectionMatches } from '@codemirror/search'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { useEffect, useRef } from 'react'
import { argusKeymap } from '../editorKeymap'
import { argusEditorTheme } from '../editorTheme'
import { languageFor } from '../languages'
import { applyDiagnosticsToView, cmdClickDefinition, lspExtensions } from '../lsp'
import { documents, registerActiveView, setExtensionsBuilder, useWorkspaceStore } from '../store'
import { EditorTabs } from './EditorTabs'

/** Builds the full extension set for a document (registered with the store). */
function buildExtensions(path: string): Extension[] {
  const sync = EditorView.updateListener.of((update) => {
    documents.noteViewUpdate(path, update.state, update.docChanged)
    if (update.selectionSet || update.docChanged) {
      const head = update.state.selection.main.head
      const line = update.state.doc.lineAt(head)
      useWorkspaceStore.getState().setCursor({ line: line.number, col: head - line.from + 1 })
    }
  })

  return [
    basicSetup,
    argusKeymap(() => void documents.save(path)),
    highlightSelectionMatches(),
    sync,
    ...argusEditorTheme,
    ...languageFor(path),
    ...lspExtensions(path),
    cmdClickDefinition()
  ]
}

setExtensionsBuilder(buildExtensions)

export function EditorPane(): React.JSX.Element {
  const tabs = useWorkspaceStore((s) => s.tabs)
  const epoch = useWorkspaceStore((s) => s.activeDocEpoch)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const shownPathRef = useRef<string | null>(null)

  const activePath = tabs.tabs[tabs.activeIndex]?.path ?? null

  // One persistent EditorView; tab switches swap the EditorState (spec 06)
  useEffect(() => {
    if (!containerRef.current) return undefined
    const view = new EditorView({ parent: containerRef.current })
    viewRef.current = view
    registerActiveView(view)
    return () => {
      registerActiveView(null)
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch intentionally re-runs this on external reloads
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    // Capture the scroll position of the doc currently in the view (also
    // when re-setting the same doc, e.g. external reloads, so it restores
    // in place)
    const leaving = shownPathRef.current
    if (leaving) {
      const doc = documents.get(leaving)
      if (doc) doc.lastScrollTop = view.scrollDOM.scrollTop
    }

    if (!activePath) {
      shownPathRef.current = null
      return
    }
    const doc = documents.get(activePath)
    if (!doc) return

    view.setState(doc.state)
    shownPathRef.current = activePath
    applyDiagnosticsToView(view, activePath)

    // setState keeps the scroll DOM's position, so always set it: the
    // in-session position when the doc was shown before, else top — then
    // any persisted position from a previous session (first open only)
    if (doc.lastScrollTop !== null) {
      view.scrollDOM.scrollTop = doc.lastScrollTop
    } else {
      view.scrollDOM.scrollTop = 0
      void window.api.loadFileViewState(activePath).then((stored) => {
        if (!stored || shownPathRef.current !== activePath) return
        const offset = Math.min(stored.cursorOffset, view.state.doc.length)
        view.dispatch({ selection: { anchor: offset } })
        view.scrollDOM.scrollTop = stored.scrollTop
      })
    }
  }, [activePath, epoch])

  return (
    <div className="flex h-full min-w-0 flex-col">
      <EditorTabs />
      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          className={`h-full overflow-hidden ${activePath ? '' : 'hidden'}`}
        />
        {!activePath && (
          <div className="absolute inset-0 flex items-center justify-center text-[13px] text-fg-dim">
            Open a file from the tree — or Cmd+Shift+O
          </div>
        )}
      </div>
    </div>
  )
}
