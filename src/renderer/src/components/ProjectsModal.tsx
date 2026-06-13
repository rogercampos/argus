import { useCallback } from 'react'
import { useWorkspaceStore } from '../store'
import { Modal, ModalHeader } from './Modal'
import { Badge } from './ui/Badge'
import { EmptyState } from './ui/EmptyState'

/** Projects view (spec 01): detected monorepo projects with their tooling. */
export function ProjectsModal(): React.JSX.Element {
  const projects = useWorkspaceStore((s) => s.projects)

  const close = useCallback((): void => {
    useWorkspaceStore.setState({ openModal: null })
  }, [])

  return (
    <Modal id="projects" defaultWidth={640} defaultHeight={420} onClose={close}>
      <ModalHeader>Projects ({projects.length})</ModalHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {projects.length === 0 && (
          <EmptyState>
            No projects detected yet — projects are discovered as you open files.
          </EmptyState>
        )}
        {projects.map((project) => (
          <div key={project.root} className="rounded-md border border-edge bg-primary/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-body text-fg">{project.relRoot}</span>
              {project.isRails && <Badge tone="error">Rails</Badge>}
              {project.kinds.map((kind) => (
                <Badge key={kind}>{kind}</Badge>
              ))}
            </div>
            {Object.keys(project.toolVersions).length > 0 && (
              <div className="mt-1 flex gap-3 text-label text-fg-dim">
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
