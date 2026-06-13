import { useEffect, useState } from 'react'
import { useWorkspaceStore } from '../store'
import { FileIcon } from './FileIcon'

interface ContextMenuState {
  x: number
  y: number
  tabIndex: number
}

export function EditorTabs(): React.JSX.Element | null {
  const tabs = useWorkspaceStore((s) => s.tabs)
  const dirtyPaths = useWorkspaceStore((s) => s.dirtyPaths)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  useEffect(() => {
    if (!menu) return undefined
    const close = (): void => setMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  if (tabs.tabs.length === 0) return null

  return (
    <div className="relative flex h-(--size-tabstrip) shrink-0 items-end overflow-x-auto border-b border-edge bg-secondary [scrollbar-width:none]">
      {tabs.tabs.map((tab, index) => {
        const name = tab.path.split('/').pop()
        const active = index === tabs.activeIndex
        const dirty = dirtyPaths[tab.path]
        return (
          <div
            key={tab.path}
            className={`group flex h-full shrink-0 items-center border-b-2 ${
              active
                ? 'border-caret bg-primary text-white'
                : 'border-transparent text-fg-dim hover:text-fg'
            } ${tab.external ? 'bg-external' : ''}`}
          >
            <button
              type="button"
              onClick={() => void useWorkspaceStore.getState().activateTab(index)}
              onAuxClick={(e) => {
                if (e.button === 1) void useWorkspaceStore.getState().closeTabAt(index)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, tabIndex: index })
              }}
              className="focus-ring -outline-offset-2 flex h-full cursor-pointer items-center gap-1.5 pl-3 text-chrome"
              title={tab.path}
            >
              <FileIcon path={tab.path} />
              <span>{name}</span>
            </button>
            {/* dirty dot doubles as the close button (RubyMine-style) */}
            <button
              type="button"
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation()
                void useWorkspaceStore.getState().closeTabAt(index)
              }}
              className={`focus-ring -outline-offset-2 flex h-full w-6 cursor-pointer items-center justify-center text-body ${
                dirty
                  ? 'text-caret hover:text-fg [&>.dot]:group-hover:hidden [&>.x]:hidden [&>.x]:group-hover:block'
                  : `text-fg-dim hover:text-fg ${active ? '' : 'opacity-0 group-hover:opacity-100'}`
              }`}
            >
              {dirty ? (
                <>
                  <span className="dot h-1.5 w-1.5 rounded-full bg-caret" title="Unsaved changes" />
                  <span className="x">×</span>
                </>
              ) : (
                <span>×</span>
              )}
            </button>
          </div>
        )
      })}

      {menu && (
        <div
          style={{ left: menu.x, top: menu.y }}
          className="fixed z-50 min-w-40 rounded-md border border-edge bg-secondary py-1 shadow-popover"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {(
            [
              ['Close', () => useWorkspaceStore.getState().closeTabAt(menu.tabIndex)],
              ['Close Other Tabs', () => useWorkspaceStore.getState().closeOthers(menu.tabIndex)],
              ['Close All Tabs', () => useWorkspaceStore.getState().closeAllTabs()]
            ] as const
          ).map(([label, action]) => (
            <button
              type="button"
              key={label}
              onClick={() => {
                setMenu(null)
                void action()
              }}
              className="focus-ring -outline-offset-2 block w-full cursor-pointer px-3 py-1 text-left text-chrome hover:bg-hover"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
