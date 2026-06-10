import { useCallback, useState } from 'react'
import { activeTabPath, activeView, documents, jumpHistory, useWorkspaceStore } from '../store'
import { Modal } from './Modal'

/** Go to Line (spec 05): accepts N or N:C, 1-indexed, clamps, centers. */
export function GoToLineModal(): React.JSX.Element {
  const [value, setValue] = useState('')

  const close = useCallback((): void => {
    useWorkspaceStore.setState({ openModal: null })
  }, [])

  const go = useCallback((): void => {
    const match = /^(\d+)(?::(\d+))?$/.exec(value.trim())
    const path = activeTabPath()
    close()
    if (!match || !path) return

    // record the departing location (spec 05)
    const doc = documents.get(path)
    const view = activeView()
    if (doc) {
      jumpHistory.record({
        path,
        cursorOffset: doc.state.selection.main.head,
        scrollTop: view?.scrollDOM.scrollTop ?? 0
      })
    }
    void useWorkspaceStore.getState().navigateTo(path, {
      line: Number(match[1]),
      col: match[2] ? Number(match[2]) : undefined
    })
  }, [value, close])

  return (
    <Modal id="go-to-line" defaultWidth={300} defaultHeight={110} minHeight={80} onClose={close}>
      <div className="flex h-full flex-col gap-2 p-3">
        <input
          // biome-ignore lint/a11y/noAutofocus: modals own focus by design (spec 05)
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              go()
            }
          }}
          placeholder="Line[:column]"
          className="rounded border border-edge bg-primary px-3 py-1.5 font-mono text-[13px] outline-none placeholder:text-fg-dim"
        />
        <button
          type="button"
          onClick={go}
          className="ml-auto cursor-pointer rounded bg-button-primary px-4 py-1 text-[12px] font-medium text-black hover:opacity-90"
        >
          Go
        </button>
      </div>
    </Modal>
  )
}
