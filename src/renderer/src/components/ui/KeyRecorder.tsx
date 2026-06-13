import { useEffect, useState } from 'react'
import {
  type Accelerator,
  eventToAccelerator,
  formatAccelerator
} from '../../../../shared/shortcuts'

/** True while any recorder is capturing — lets the Modal keep Esc for "cancel
 * recording" instead of closing itself. */
let activeRecorders = 0
export function isRecordingShortcut(): boolean {
  return activeRecorders > 0
}

/**
 * Press-to-set shortcut field. Click to start capturing, then press the desired
 * combination; Esc cancels, Backspace/Delete clears the binding. The whole
 * keyboard is captured while recording so the keys don't trigger other
 * shortcuts.
 */
export function KeyRecorder({
  value,
  conflict = false,
  onCapture
}: {
  value: Accelerator | null
  conflict?: boolean
  onCapture: (accel: Accelerator | null) => void
}): React.JSX.Element {
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return
    activeRecorders++
    // drop the native menu so its accelerators don't shadow the capture
    void window.api.suspendMenu()
    const onKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false)
        return
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        onCapture(null)
        setRecording(false)
        return
      }
      const accel = eventToAccelerator(e)
      if (accel) {
        onCapture(accel)
        setRecording(false)
      }
      // otherwise only modifiers are held — keep waiting
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      activeRecorders--
      window.removeEventListener('keydown', onKeyDown, true)
      void window.api.resumeMenu()
    }
  }, [recording, onCapture])

  const base =
    'focus-ring min-w-24 rounded border px-2 py-1 text-center font-mono text-label cursor-pointer'
  const tone = recording
    ? 'border-accent bg-accent/10 text-accent'
    : conflict
      ? 'border-error/60 bg-error/10 text-error hover:bg-error/15'
      : 'border-edge bg-primary text-fg hover:bg-hover'

  return (
    <button
      type="button"
      title={recording ? 'Press a shortcut — Esc cancels, ⌫ clears' : 'Click to change'}
      onClick={() => setRecording((r) => !r)}
      onBlur={() => setRecording(false)}
      className={`${base} ${tone}`}
    >
      {recording ? (
        'Press keys…'
      ) : value ? (
        formatAccelerator(value)
      ) : (
        <span className="text-fg-dim">Unbound</span>
      )}
    </button>
  )
}
