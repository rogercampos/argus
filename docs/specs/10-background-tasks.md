# Spec 10 — Background Tasks & Slow-Operation Reporting

A single, central system through which all long-running backend work reports
itself. Nothing long-running may be invisible.

## Task model

```ts
interface BackgroundTask {
  id: number                  // monotonic
  name: string                // "Installing ruby-lsp", "Resolving project env", "Replacing in files"
  message?: string            // current detail, e.g. file being processed
  percentage?: number         // 0-100 when known
  state: 'queued' | 'active'
}
```

Lifecycle notifications from main → renderer: `queued` (optional) →
`started` → `progress`* → `finished`. The renderer keeps an ordered map of
in-flight tasks; `finished` removes the entry.

Task sources (non-exhaustive): LSP server install/update, project env
resolution, global replace, full git rescans (only if >1s), schema parsing,
LSP-initiated `$/progress` work (indexing — bridge LSP progress into the
same model).

## UI

1. **Status bar indicator** (spec 02): when ≥1 task is active, show a gear
   icon pulsing (opacity `0.7 + 0.3·sin`, 2s cycle) + the name of the most
   recently started active task. Hidden when idle.
2. **Tasks popup**: clicking the indicator toggles a floating popup anchored
   above the status bar — width 400px, max-height 300px (scrollable), 6px
   radius. Each row: state icon (pulsing gear = active, clock = queued),
   task name, dimmed message, percentage when present
   ("ESLint install — 45%"). Click-outside closes. No cancel buttons in
   phase 1.

## Slow-operation report

Instrumentation to catch anything blocking interactivity:

- **Main process**: every IPC handler and task is timed. Handlers slower
  than **200ms** and tasks slower than **10s** log a structured warning
  (operation, duration, args summary).
- **Renderer**: long-task observation (PerformanceObserver) logs frames
  blocked > 100ms with the active feature context.
- A debug command (`Help > Show Slow Operations`) opens a tab listing the
  session's recorded slow operations (time, operation, duration), most
  recent first. This is a developer-facing diagnostic view; plain table,
  no polish needed.

## Acceptance checklist

- [ ] Installing an LSP server shows indicator + popup entry with progress.
- [ ] Multiple tasks listed in start order; finished tasks vanish.
- [ ] Indicator idle-hidden; popup toggles on click and closes on outside
      click.
- [ ] Slow-op log captures an artificially delayed IPC handler.
