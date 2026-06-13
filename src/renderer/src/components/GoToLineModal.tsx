import { useCallback, useState } from 'react'
import { activeTabPath, activeView, documents, jumpHistory, useWorkspaceStore } from '../store'
import { Modal } from './Modal'
import { Button } from './ui/Button'
import { TextInput } from './ui/TextInput'

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
        <TextInput
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
        />
        <Button variant="primary" size="sm" className="ml-auto" onClick={go}>
          Go
        </Button>
      </div>
    </Modal>
  )
}
