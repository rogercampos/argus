import { useState } from 'react'
import type { CrashReport } from '../../../shared/types'
import { useWorkspaceStore } from '../store'
import { Button } from './ui/Button'

/**
 * Surfaces main- and child-process crashes (LSP servers, git, ripgrep, the
 * main process itself) as a stack of dismissable cards. Each shows the exact
 * cause and full output, with one-click Copy so the whole thing is easy to
 * paste into a bug report. Cards persist until dismissed (spec: cards only).
 */

/** The full, copyable text for one report. */
function reportText(report: CrashReport): string {
  const head = report.label ? `${report.title} — ${report.label}` : report.title
  return `${head}\n${report.summary}\n\n${report.detail}`
}

export function CrashCard({
  report,
  onDismiss
}: {
  report: CrashReport
  onDismiss: () => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = (): void => {
    void window.api.copyToClipboard(reportText(report))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="pointer-events-auto w-96 max-w-[90vw] overflow-hidden rounded-md border border-error/50 bg-secondary text-chrome shadow-popover">
      <div className="flex items-start gap-2 border-error/20 border-b px-3 py-2">
        <span aria-hidden="true" className="text-error">
          ⚠
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-error">{report.title}</div>
          {report.label && <div className="truncate text-fg-dim text-label">{report.label}</div>}
        </div>
        <Button size="sm" variant="ghost" onClick={copy} title="Copy full output">
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss} title="Dismiss" aria-label="Dismiss">
          ✕
        </Button>
      </div>
      <div className="px-3 py-2">
        <div className="break-words text-fg">{report.summary}</div>
        {expanded && (
          <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-primary p-2 font-mono text-fg-dim text-label">
            {report.detail}
          </pre>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 cursor-pointer text-accent text-label hover:underline"
        >
          {expanded ? 'Hide output' : 'Show full output'}
        </button>
      </div>
    </div>
  )
}

export function CrashOverlay(): React.JSX.Element | null {
  const crashes = useWorkspaceStore((s) => s.crashes)
  const dismissCrash = useWorkspaceStore((s) => s.dismissCrash)
  if (crashes.length === 0) return null
  return (
    <div className="pointer-events-none absolute right-3 bottom-3 z-40 flex flex-col gap-2">
      {crashes.map((report) => (
        <CrashCard key={report.id} report={report} onDismiss={() => dismissCrash(report.id)} />
      ))}
    </div>
  )
}
