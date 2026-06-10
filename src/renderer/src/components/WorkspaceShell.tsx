import { copyLineDown, moveLineDown, moveLineUp, toggleComment } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import { useCallback, useEffect } from 'react'
import type { MenuCommand } from '../../../shared/types'
import { useSearchStore } from '../searchStore'
import { activeTabPath, activeView, documents, useWorkspaceStore } from '../store'
import { EditorPane } from './EditorPane'
import { GoToFileModal } from './GoToFileModal'
import { GoToLineModal } from './GoToLineModal'
import { RecentFilesModal } from './RecentFilesModal'
import { Resizer } from './Resizer'
import { SearchModal } from './SearchModal'
import { SearchPanel } from './SearchPanel'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { TitleBar } from './TitleBar'

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max)

export function WorkspaceShell(): React.JSX.Element {
  const panels = useWorkspaceStore((s) => s.panels)
  const setPanels = useWorkspaceStore((s) => s.setPanels)
  const fileError = useWorkspaceStore((s) => s.fileError)

  useEffect(() => {
    void useWorkspaceStore
      .getState()
      .init()
      .then(() => useSearchStore.getState().init())
  }, [])

  const onMenuCommand = useCallback((command: MenuCommand): void => {
    const state = useWorkspaceStore.getState()
    const view = activeView()
    switch (command) {
      case 'toggle-file-tree':
        state.setPanels({ leftVisible: !state.panels.leftVisible })
        break
      case 'toggle-search-panel':
        state.setPanels({ bottomVisible: !state.panels.bottomVisible })
        break
      case 'toggle-schema-panel':
        state.setPanels({ rightVisible: !state.panels.rightVisible })
        break
      case 'save': {
        const path = activeTabPath()
        if (path) void documents.save(path)
        break
      }
      case 'save-all':
        void documents.saveAll()
        break
      case 'close-tab':
        void state.closeTabAt(state.tabs.activeIndex)
        break
      case 'next-tab':
        void state.cycleTabs(1)
        break
      case 'previous-tab':
        void state.cycleTabs(-1)
        break
      case 'comment-line':
        if (view) toggleComment(view)
        break
      case 'duplicate-line':
        if (view) copyLineDown(view)
        break
      case 'move-line-up':
        if (view) moveLineUp(view)
        break
      case 'move-line-down':
        if (view) moveLineDown(view)
        break
      case 'go-to-file':
        state.setModal('go-to-file')
        break
      case 'recent-files':
        state.setModal('recent-files')
        break
      case 'go-to-line':
        state.setModal('go-to-line')
        break
      case 'jump-back':
        void state.jumpBack()
        break
      case 'jump-forward':
        void state.jumpForward()
        break
      case 'global-search':
        useSearchStore.getState().openModal(false)
        break
      case 'global-replace':
        useSearchStore.getState().openModal(true)
        break
      case 'find':
      case 'replace':
        if (view) {
          openSearchPanel(view)
        }
        break
      default:
        // Commands for features from later stages are ignored for now
        break
    }
  }, [])

  useEffect(() => window.api.onMenuCommand(onMenuCommand), [onMenuCommand])

  const openModal = useWorkspaceStore((s) => s.openModal)
  const searchModalOpen = useSearchStore((s) => s.modalOpen)

  return (
    <div className="shell-gradient flex h-screen flex-col">
      {openModal === 'go-to-file' && <GoToFileModal />}
      {openModal === 'recent-files' && <RecentFilesModal />}
      {openModal === 'go-to-line' && <GoToLineModal />}
      {searchModalOpen && <SearchModal />}
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
            {/* Full-width bottom panel (spec 02) */}
            <section
              style={{ height: panels.bottomHeight }}
              className="shrink-0 overflow-hidden rounded-md border border-edge bg-secondary"
            >
              <SearchPanel />
            </section>
          </>
        )}
        <div className="h-1.5 shrink-0" />
        <StatusBar />
      </div>
    </div>
  )
}
