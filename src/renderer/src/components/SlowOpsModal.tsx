import { useCallback, useEffect, useState } from 'react'
import { useWorkspaceStore } from '../store'
import { Modal, ModalHeader } from './Modal'
import { EmptyState } from './ui/EmptyState'

/** Slow operations report (spec 10): developer-facing diagnostic view. */
export function SlowOpsModal(): React.JSX.Element {
  const [ops, setOps] = useState<Array<{ time: number; operation: string; ms: number }>>([])

  useEffect(() => {
    void window.api.slowOps().then(setOps)
  }, [])

  const close = useCallback((): void => {
    useWorkspaceStore.setState({ openModal: null })
  }, [])

  return (
    <Modal id="slow-ops" defaultWidth={560} defaultHeight={400} onClose={close}>
      <ModalHeader>Slow Operations ({ops.length})</ModalHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-label">
        {ops.length === 0 && <EmptyState>No slow operations recorded this session.</EmptyState>}
        {ops.map((op) => (
          <div key={`${op.time}:${op.operation}`} className="flex gap-3 px-2 py-0.5">
            <span className="shrink-0 text-fg-dim">{new Date(op.time).toLocaleTimeString()}</span>
            <span className="truncate text-fg">{op.operation}</span>
            <span className="ml-auto shrink-0 text-warning">{op.ms}ms</span>
          </div>
        ))}
      </div>
    </Modal>
  )
}
