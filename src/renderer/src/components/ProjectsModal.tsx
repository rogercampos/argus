import { useCallback } from 'react'
import { useWorkspaceStore } from '../store'
import { Modal } from './Modal'

/** Projects view (spec 01): detected monorepo projects with their tooling. */
export function ProjectsModal(): React.JSX.Element {
  const projects = useWorkspaceStore((s) => s.projects)

  const close = useCallback((): void => {
    useWorkspaceStore.setState({ openModal: null })
  }, [])

  return (
    <Modal id="projects" defaultWidth={640} defaultHeight={420} onClose={close}>
      <div className="shrink-0 border-b border-edge px-4 py-2 text-[11px] font-semibold tracking-wider text-fg-dim uppercase">
        Projects ({projects.length})
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {projects.length === 0 && (
          <div className="px-2 py-4 text-[12px] text-fg-dim">
            No projects detected yet — projects are discovered as you open files.
          </div>
        )}
        {projects.map((project) => (
          <div
            key={project.root}
            className="mb-2 rounded-md border border-edge bg-primary/40 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[13px] text-fg">{project.relRoot}</span>
              {project.isRails && (
                <span className="rounded bg-error/20 px-1.5 text-[10px] text-error">Rails</span>
              )}
              {project.kinds.map((kind) => (
                <span key={kind} className="rounded bg-hover px-1.5 text-[10px] text-fg-dim">
                  {kind}
                </span>
              ))}
            </div>
            {Object.keys(project.toolVersions).length > 0 && (
              <div className="mt-1 flex gap-3 text-[11px] text-fg-dim">
                {Object.entries(project.toolVersions).map(([tool, version]) => (
                  <span key={tool}>
                    {tool} {version}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}
