import { BrowserWindow } from 'electron'
import type { CrashReport } from '../shared/types'

/**
 * Surfaces crashes from the main process and every child process (LSP servers,
 * git, ripgrep, …) into the renderer as copyable error cards. Spawn sites and
 * the global handlers in index.ts call reportCrash(); the renderer listens on
 * the `app:crash` channel.
 */

/** Cap the copyable detail so a runaway stderr can't bloat IPC payloads. */
export const MAX_DETAIL = 16 * 1024

export interface CrashInput {
  origin: CrashReport['origin']
  title: string
  /** which process; empty for the main process itself */
  label?: string
  summary: string
  detail: string
  /** owning workspace window; omitted = broadcast to every window */
  windowId?: number
}

let seq = 0

/** Build a normalized, size-capped report. Pure — exported for tests. */
export function buildCrashReport(input: CrashInput, at: number, id: string): CrashReport {
  let detail = input.detail.trim()
  if (detail.length > MAX_DETAIL) {
    detail = `${detail.slice(0, MAX_DETAIL)}\n…(truncated)`
  }
  return {
    id,
    at,
    origin: input.origin,
    title: input.title,
    label: input.label ?? '',
    summary: input.summary,
    detail: detail || '(no output captured)'
  }
}

/** Targets for a report: a specific window if given and alive, else all windows. */
function targetWindows(windowId: number | undefined): BrowserWindow[] {
  if (windowId !== undefined) {
    const window = BrowserWindow.fromId(windowId)
    return window ? [window] : []
  }
  return BrowserWindow.getAllWindows()
}

export function reportCrash(input: CrashInput): void {
  const report = buildCrashReport(input, Date.now(), `${Date.now()}-${seq++}`)
  // Always log to the terminal too, so a crash is recoverable even if no
  // window can render it (e.g. the renderer itself is the thing that died).
  console.error(`[crash] ${report.title} — ${report.label} — ${report.summary}\n${report.detail}`)
  for (const window of targetWindows(input.windowId)) {
    if (!window.isDestroyed()) window.webContents.send('app:crash', report)
  }
}
