import type { ProcStatEntry } from '../../../shared/types'
import { useProcStore } from '../procStore'
import { useWorkspaceStore } from '../store'
import { useTasksStore } from '../tasksStore'
import { SectionLabel } from './ui/SectionLabel'

function TasksIndicator(): React.JSX.Element | null {
  const tasks = useTasksStore((s) => s.tasks)
  const popupVisible = useTasksStore((s) => s.popupVisible)

  if (tasks.length === 0) return null
  const current = [...tasks].reverse().find((t) => t.state === 'active') ?? tasks[0]

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => useTasksStore.getState().togglePopup()}
        className="focus-ring flex cursor-pointer items-center gap-1.5 hover:text-fg"
      >
        <span className="inline-block h-3 w-3 animate-spin rounded-full border border-fg-dim border-t-accent" />
        <span className="max-w-72 truncate">
          {current.name}
          {current.message ? ` — ${current.message}` : ''}
        </span>
      </button>
      {popupVisible && (
        <div className="absolute bottom-7 left-0 z-50 max-h-75 w-100 overflow-y-auto rounded-md border border-edge bg-secondary p-2 shadow-popover">
          {tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2 px-2 py-1.5 text-chrome">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  task.state === 'active'
                    ? 'animate-spin border border-fg-dim border-t-accent'
                    : 'bg-fg-dim/40'
                }`}
              />
              <span className="truncate text-fg">{task.name}</span>
              {task.message && <span className="truncate text-fg-dim">{task.message}</span>}
              {task.percentage !== undefined && (
                <span className="ml-auto shrink-0 text-fg-dim">{task.percentage}%</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

function formatCpu(cpu: number): string {
  return `${cpu >= 10 ? Math.round(cpu) : cpu.toFixed(1)}%`
}

function formatUptime(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${(minutes / 60).toFixed(1)}h`
}

function ProcSectionHeader({ title }: { title: string }): React.JSX.Element {
  return <SectionLabel className="px-2 pt-2 pb-0.5">{title}</SectionLabel>
}

function ProcRow({ entry }: { entry: ProcStatEntry }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-chrome">
      <span className="truncate text-fg" title={`pid ${entry.pid}`}>
        {entry.label}
      </span>
      {entry.childCount > 0 && (
        <span className="shrink-0 text-fg-dim" title={`${entry.childCount} child processes`}>
          +{entry.childCount}
        </span>
      )}
      <span className="ml-auto w-12 shrink-0 text-right text-fg-dim tabular-nums">
        {formatCpu(entry.cpu)}
      </span>
      <span className="w-16 shrink-0 text-right text-fg-dim tabular-nums">
        {formatBytes(entry.memBytes)}
      </span>
      <span className="w-10 shrink-0 text-right text-fg-dim tabular-nums">
        {formatUptime(Date.now() - entry.startedAt)}
      </span>
    </div>
  )
}

function ProcessesIndicator(): React.JSX.Element | null {
  const snapshot = useProcStore((s) => s.snapshot)
  const popupVisible = useProcStore((s) => s.popupVisible)

  if (!snapshot) return null
  const servers = snapshot.entries.filter((e) => e.kind === 'lsp')
  const others = snapshot.entries.filter((e) => e.kind !== 'lsp')
  const recentActivity = snapshot.activity.filter((a) => a.count5m > 0)
  const summary =
    snapshot.totals.count === 0
      ? '0 procs'
      : `${snapshot.totals.count} proc${snapshot.totals.count === 1 ? '' : 's'} · ${formatBytes(
          snapshot.totals.memBytes
        )} · ${formatCpu(snapshot.totals.cpu)}`

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => useProcStore.getState().togglePopup()}
        className="focus-ring cursor-pointer tabular-nums hover:text-fg"
        title="External processes (LSP servers, tools)"
      >
        {summary}
      </button>
      {popupVisible && (
        <div className="absolute bottom-7 left-0 z-50 max-h-100 w-110 overflow-y-auto rounded-md border border-edge bg-secondary p-2 shadow-popover">
          {servers.length > 0 && (
            <>
              <ProcSectionHeader title="Language servers" />
              {[...servers]
                .sort((a, b) => b.memBytes - a.memBytes)
                .map((entry) => (
                  <ProcRow key={entry.id} entry={entry} />
                ))}
            </>
          )}
          {others.length > 0 && (
            <>
              <ProcSectionHeader title="Running" />
              {[...others]
                .sort((a, b) => b.memBytes - a.memBytes)
                .map((entry) => (
                  <ProcRow key={entry.id} entry={entry} />
                ))}
            </>
          )}
          {snapshot.entries.length === 0 && (
            <div className="px-2 py-1 text-chrome text-fg-dim">No external processes running</div>
          )}
          {recentActivity.length > 0 && (
            <>
              <ProcSectionHeader title="Activity (last 5 min)" />
              <div className="px-2 py-1 text-chrome text-fg-dim">
                {recentActivity
                  .map(
                    (a) =>
                      `${a.kind} ×${a.count5m}${a.avgMs5m !== null ? ` avg ${a.avgMs5m}ms` : ''}`
                  )
                  .join(' · ')}
              </div>
            </>
          )}
          <ProcSectionHeader title="App" />
          {snapshot.app.map((proc) => (
            <div key={proc.pid} className="flex items-center gap-2 px-2 py-1 text-chrome">
              <span className="truncate text-fg" title={`pid ${proc.pid}`}>
                {proc.type}
              </span>
              <span className="ml-auto w-12 shrink-0 text-right text-fg-dim tabular-nums">
                {formatCpu(proc.cpu)}
              </span>
              <span className="w-16 shrink-0 text-right text-fg-dim tabular-nums">
                {formatBytes(proc.memBytes)}
              </span>
              <span className="w-10 shrink-0" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function StatusBar(): React.JSX.Element {
  const cursor = useWorkspaceStore((s) => s.cursor)
  const language = useWorkspaceStore((s) => s.language)

  return (
    <footer className="flex h-[25px] shrink-0 items-center gap-4 rounded-md border border-edge bg-secondary px-3 text-label text-fg-dim">
      <TasksIndicator />
      <ProcessesIndicator />
      <div className="flex-1" />
      {cursor && (
        <button
          type="button"
          onClick={() => useWorkspaceStore.getState().setModal('go-to-line')}
          className="focus-ring cursor-pointer tabular-nums hover:text-fg"
        >
          {cursor.line}:{cursor.col}
        </button>
      )}
      {language && <span>{language}</span>}
    </footer>
  )
}
