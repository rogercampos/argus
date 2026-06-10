import { useCallback, useEffect } from 'react'
import type { MenuCommand } from '../../../shared/types'
import { useWorkspaceStore } from '../store'
import { EditorPane } from './EditorPane'
import { Resizer } from './Resizer'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { TitleBar } from './TitleBar'

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max)

export function WorkspaceShell(): React.JSX.Element {
  const panels = useWorkspaceStore((s) => s.panels)
  const setPanels = useWorkspaceStore((s) => s.setPanels)
  const fileError = useWorkspaceStore((s) => s.fileError)

  useEffect(() => {
    void useWorkspaceStore.getState().init()
  }, [])

  const onMenuCommand = useCallback((command: MenuCommand): void => {
    const { panels, setPanels } = useWorkspaceStore.getState()
    switch (command) {
      case 'toggle-file-tree':
        setPanels({ leftVisible: !panels.leftVisible })
        break
      case 'toggle-search-panel':
        setPanels({ bottomVisible: !panels.bottomVisible })
        break
      case 'toggle-schema-panel':
        setPanels({ rightVisible: !panels.rightVisible })
        break
      default:
        // Commands for features from later stages are ignored for now
        break
    }
  }, [])

  useEffect(() => window.api.onMenuCommand(onMenuCommand), [onMenuCommand])

  return (
    <div className="shell-gradient flex h-screen flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
        <div className="flex min-h-0 flex-1">
          {panels.leftVisible && (
            <>
              <aside
                style={{ width: panels.leftWidth }}
                className="shrink-0 overflow-hidden rounded-md border border-edge bg-secondary"
              >
                <Sidebar />
              </aside>
              <Resizer
                direction="horizontal"
                onDrag={(delta) =>
                  setPanels({
                    leftWidth: clamp(
                      useWorkspaceStore.getState().panels.leftWidth + delta,
                      150,
                      600
                    )
                  })
                }
              />
            </>
          )}
          <main className="min-w-0 flex-1 overflow-hidden rounded-md border border-edge bg-primary">
            {fileError ? (
              <div className="flex h-full items-center justify-center px-8 text-[13px] text-warning">
                {fileError}
              </div>
            ) : (
              <EditorPane />
            )}
          </main>
          {panels.rightVisible && (
            <>
              <Resizer
                direction="horizontal"
                onDrag={(delta) =>
                  setPanels({
                    rightWidth: clamp(
                      useWorkspaceStore.getState().panels.rightWidth - delta,
                      150,
                      600
                    )
                  })
                }
              />
              <aside
                style={{ width: panels.rightWidth }}
                className="shrink-0 overflow-hidden rounded-md border border-edge bg-secondary"
              >
                {/* Schema panel mounts here in stage 6 */}
              </aside>
            </>
          )}
        </div>
        {panels.bottomVisible && (
          <>
            <Resizer
              direction="vertical"
              onDrag={(delta) =>
                setPanels({
                  bottomHeight: clamp(
                    useWorkspaceStore.getState().panels.bottomHeight - delta,
                    100,
                    800
                  )
                })
              }
            />
            {/* Full-width bottom panel (spec 02); search tabs mount here in stage 4 */}
            <section
              style={{ height: panels.bottomHeight }}
              className="shrink-0 overflow-hidden rounded-md border border-edge bg-secondary"
            >
              <div className="flex h-full items-center justify-center text-[12px] text-fg-dim">
                Search results will live here
              </div>
            </section>
          </>
        )}
        <div className="h-1.5 shrink-0" />
        <StatusBar />
      </div>
    </div>
  )
}
