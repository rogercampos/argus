import { useCallback, useEffect, useState } from 'react'
import { useWorkspaceStore } from '../store'
import { Modal } from './Modal'

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
      <div className="shrink-0 border-b border-edge px-4 py-2 text-[11px] font-semibold tracking-wider text-fg-dim uppercase">
        Slow Operations ({ops.length})
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-[11px]">
        {ops.length === 0 && (
          <div className="px-2 py-4 text-fg-dim">No slow operations recorded this session.</div>
        )}
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
