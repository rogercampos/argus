import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { useEffect, useRef } from 'react'
import { argusEditorTheme } from '../editorTheme'
import { useWorkspaceStore } from '../store'

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

export function EditorPane(): React.JSX.Element {
  const openedFile = useWorkspaceStore((s) => s.openedFile)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || !openedFile) return undefined

    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: (view) => {
          void useWorkspaceStore.getState().saveFile(view.state.doc.toString())
          return true
        }
      }
    ])

    const cursorTracker = EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) {
        const head = update.state.selection.main.head
        const line = update.state.doc.lineAt(head)
        useWorkspaceStore.getState().setCursor({
          line: line.number,
          col: head - line.from + 1
        })
      }
    })

    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: openedFile.content,
        extensions: [
          basicSetup,
          saveKeymap,
          cursorTracker,
          ...argusEditorTheme,
          ...languageFor(openedFile.path)
        ]
      })
    })

    return () => {
      view.destroy()
      useWorkspaceStore.getState().setCursor(null)
    }
  }, [openedFile])

  if (!openedFile) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-fg-dim">
        Select a file to open it
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="border-b border-edge px-4 py-1.5 font-mono text-[11px] text-fg-dim">
        {openedFile.path}
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden" />
    </div>
  )
}
