import { useWorkspaceStore } from '../store'
import { useTasksStore } from '../tasksStore'

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
        className="flex cursor-pointer items-center gap-1.5 hover:text-fg"
      >
        <span className="inline-block h-3 w-3 animate-spin rounded-full border border-fg-dim border-t-accent" />
        <span className="max-w-72 truncate">
          {current.name}
          {current.message ? ` — ${current.message}` : ''}
        </span>
      </button>
      {popupVisible && (
        <div className="absolute bottom-7 left-0 z-50 max-h-75 w-100 overflow-y-auto rounded-md border border-edge bg-secondary p-2 shadow-[0_8px_30px_rgba(0,0,0,.4)]">
          {tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2 px-2 py-1.5 text-[12px]">
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

export function StatusBar(): React.JSX.Element {
  const cursor = useWorkspaceStore((s) => s.cursor)
  const language = useWorkspaceStore((s) => s.language)
  const counts = useWorkspaceStore((s) => s.diagnosticCounts)

  return (
    <footer className="flex h-[25px] shrink-0 items-center gap-4 rounded-md border border-edge bg-secondary px-3 text-[11px] text-fg-dim">
      {(counts.errors > 0 || counts.warnings > 0) && (
        <span className="flex items-center gap-2">
          {counts.errors > 0 && <span className="text-error">● {counts.errors}</span>}
          {counts.warnings > 0 && <span className="text-warning">▲ {counts.warnings}</span>}
        </span>
      )}
      <TasksIndicator />
      <div className="flex-1" />
      {cursor && (
        <button
          type="button"
          onClick={() => useWorkspaceStore.getState().setModal('go-to-line')}
          className="cursor-pointer hover:text-fg"
        >
          {cursor.line}:{cursor.col}
        </button>
      )}
      {language && <span>{language}</span>}
    </footer>
  )
}
