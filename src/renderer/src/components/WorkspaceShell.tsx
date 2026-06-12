import { copyLineDown, moveLineDown, moveLineUp, toggleComment } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import { useCallback, useEffect } from 'react'
import type { MenuCommand } from '../../../shared/types'
import { gotoDefinition, initLsp } from '../lsp'
import { useProcStore } from '../procStore'
import { useSearchStore } from '../searchStore'
import { activeTabPath, activeView, documents, useWorkspaceStore } from '../store'
import { useTasksStore } from '../tasksStore'
import { DefinitionPicker } from './DefinitionPicker'
import { EditorPane } from './EditorPane'
import { GoToFileModal } from './GoToFileModal'
import { GoToLineModal } from './GoToLineModal'
import { GoToSymbolModal } from './GoToSymbolModal'
import { ProjectsModal } from './ProjectsModal'
import { RecentFilesModal } from './RecentFilesModal'
import { Resizer } from './Resizer'
import { SchemaPanel } from './SchemaPanel'
import { SearchModal } from './SearchModal'
import { SearchPanel } from './SearchPanel'
import { Sidebar } from './Sidebar'
import { SlowOpsModal } from './SlowOpsModal'
import { StatusBar } from './StatusBar'
import { TitleBar } from './TitleBar'

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max)

/** Store inits register IPC listeners; double-running (React StrictMode
 * re-mounts effects in dev) would duplicate every streamed result. */
let storesInitialized = false

export function WorkspaceShell(): React.JSX.Element {
  const panels = useWorkspaceStore((s) => s.panels)
  const setPanels = useWorkspaceStore((s) => s.setPanels)
  const fileError = useWorkspaceStore((s) => s.fileError)
  const notice = useWorkspaceStore((s) => s.notice)

  useEffect(() => {
    if (storesInitialized) return
    storesInitialized = true
    useTasksStore.getState().init()
    useProcStore.getState().init()
    initLsp()
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
      case 'go-to-symbol':
        state.setModal('go-to-symbol')
        break
      case 'go-to-definition':
        void gotoDefinition('definition')
        break
      case 'go-to-type-definition':
        void gotoDefinition('typeDefinition')
        break
      case 'find':
      case 'replace':
        if (view) {
          openSearchPanel(view)
        }
        break
      case 'copy-relative-path': {
        const path = activeTabPath()
        if (path) void navigator.clipboard.writeText(path)
        break
      }
      case 'show-projects':
        state.setModal('projects')
        break
      case 'show-slow-ops':
        state.setModal('slow-ops')
        break
      default:
        // Commands for features from later stages are ignored for now
        break
    }
  }, [])

  useEffect(() => window.api.onMenuCommand(onMenuCommand), [onMenuCommand])

  // Rails schema panel follows the active model file (spec 11)
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activePath = tabs.tabs[tabs.activeIndex]?.path ?? null
  useEffect(() => {
    if (!activePath || !/app\/models\/.+\.rb$/.test(activePath)) {
      useWorkspaceStore.setState({ schemaInfo: null })
      const { panels, setPanels } = useWorkspaceStore.getState()
      if (panels.rightVisible) setPanels({ rightVisible: false })
      return
    }
    void window.api.railsSchemaFor(activePath).then((schemaInfo) => {
      if (
        useWorkspaceStore.getState().tabs.tabs[useWorkspaceStore.getState().tabs.activeIndex]
          ?.path !== activePath
      )
        return
      useWorkspaceStore.setState({ schemaInfo })
      const { panels, setPanels } = useWorkspaceStore.getState()
      if (schemaInfo && !panels.rightVisible) setPanels({ rightVisible: true })
      if (!schemaInfo && panels.rightVisible) setPanels({ rightVisible: false })
    })
  }, [activePath])

  const openModal = useWorkspaceStore((s) => s.openModal)
  const searchModalOpen = useSearchStore((s) => s.modalOpen)
  const definitionChoices = useWorkspaceStore((s) => s.definitionChoices)

  return (
    <div className="shell-gradient flex h-screen flex-col">
      {openModal === 'go-to-file' && <GoToFileModal />}
      {openModal === 'recent-files' && <RecentFilesModal />}
      {openModal === 'go-to-line' && <GoToLineModal />}
      {openModal === 'go-to-symbol' && <GoToSymbolModal />}
      {openModal === 'projects' && <ProjectsModal />}
      {openModal === 'slow-ops' && <SlowOpsModal />}
      {searchModalOpen && <SearchModal />}
      {definitionChoices && <DefinitionPicker choices={definitionChoices} />}
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
          <main className="relative min-w-0 flex-1 overflow-hidden rounded-md border border-edge bg-primary">
            {notice && (
              <div className="absolute top-10 left-1/2 z-30 -translate-x-1/2 rounded-md border border-edge bg-secondary px-3 py-1.5 text-[12px] text-fg-dim shadow-[0_4px_16px_rgba(0,0,0,.4)]">
                {notice}
              </div>
            )}
            {fileError && (
              <button
                type="button"
                onClick={() => useWorkspaceStore.setState({ fileError: null })}
                className="absolute top-10 right-3 z-30 cursor-pointer rounded-md border border-edge bg-secondary px-3 py-1.5 text-[12px] text-warning shadow-[0_4px_16px_rgba(0,0,0,.4)]"
                title="Dismiss"
              >
                {fileError} ✕
              </button>
            )}
            <EditorPane />
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
                <SchemaPanel />
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
