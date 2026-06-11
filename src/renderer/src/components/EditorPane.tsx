import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { highlightSelectionMatches } from '@codemirror/search'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { useEffect, useRef } from 'react'
import { argusKeymap } from '../editorKeymap'
import { argusEditorTheme } from '../editorTheme'
import { applyDiagnosticsToView, lspExtensions } from '../lsp'
import { documents, registerActiveView, setExtensionsBuilder, useWorkspaceStore } from '../store'
import { EditorTabs } from './EditorTabs'

function languageFor(path: string): Extension[] {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return [javascript()]
    case 'jsx':
      return [javascript({ jsx: true })]
    case 'ts':
      return [javascript({ typescript: true })]
    case 'tsx':
      return [javascript({ typescript: true, jsx: true })]
    case 'css':
      return [css()]
    case 'html':
    case 'htm':
      return [html()]
    case 'json':
      return [json()]
    case 'md':
    case 'markdown':
      return [markdown()]
    case 'py':
      return [python()]
    default:
      return []
  }
}

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
    ...lspExtensions(path)
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

    // Capture scroll position of the doc we are leaving
    const leaving = shownPathRef.current
    if (leaving && leaving !== activePath) {
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

    // Restore scroll: in-session position, else persisted position
    if (doc.lastScrollTop > 0) {
      view.scrollDOM.scrollTop = doc.lastScrollTop
    } else {
      void window.api.loadFileViewState(activePath).then((stored) => {
        if (!stored || shownPathRef.current !== activePath) return
        const offset = Math.min(stored.cursorOffset, view.state.doc.length)
        view.dispatch({ selection: { anchor: offset } })
        view.scrollDOM.scrollTop = stored.scrollTop
      })
    }
  }, [activePath, epoch])

  // Keep doc.state authoritative when the view updates it
  useEffect(() => {
    const view = viewRef.current
    if (!view) return undefined
    const interval = setInterval(() => {
      const path = shownPathRef.current
      if (!path) return
      const doc = documents.get(path)
      if (doc && view.state !== doc.state) {
        // noteViewUpdate keeps doc.state in sync; this is a safety net only
        doc.state = view.state
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [])

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
