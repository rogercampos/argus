import { BrowserWindow } from 'electron'
import type { BackgroundTaskUpdate } from '../shared/types'

/**
 * Background task reporting (spec 10): every long-running backend operation
 * announces itself; the renderer shows the status-bar indicator + popup.
 */

let nextTaskId = 1_000_000_000

export interface TaskHandle {
  id: number
  progress: (message?: string, percentage?: number) => void
  finish: () => void
}

function broadcast(window: BrowserWindow | null, update: BackgroundTaskUpdate): void {
  const targets = window ? [window] : BrowserWindow.getAllWindows()
  for (const w of targets) {
    if (!w.isDestroyed()) w.webContents.send('task:update', update)
  }
}

/** Start a reported task. Pass the owning window, or null to broadcast. */
export function startTask(window: BrowserWindow | null, name: string): TaskHandle {
  const id = nextTaskId++
  broadcast(window, { id, status: 'started', name })
  return {
    id,
    progress: (message, percentage) =>
      broadcast(window, { id, status: 'progress', name, message, percentage }),
    finish: () => broadcast(window, { id, status: 'finished', name })
  }
}

/** Times an operation and logs a slow-op warning over the threshold (spec 10). */
export async function timed<T>(
  operation: string,
  thresholdMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now()
  try {
    return await fn()
  } finally {
    const elapsed = Date.now() - start
    if (elapsed > thresholdMs) {
      console.warn(`[slow-op] ${operation} took ${elapsed}ms`)
    }
  }
}
