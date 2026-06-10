import { useEffect, useState } from 'react'
import { useWorkspaceStore } from '../store'

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
    <div className="relative flex h-[35px] shrink-0 items-end overflow-x-auto border-b border-edge bg-secondary [scrollbar-width:none]">
      {tabs.tabs.map((tab, index) => {
        const name = tab.path.split('/').pop()
        const active = index === tabs.activeIndex
        const dirty = dirtyPaths[tab.path]
        return (
          <button
            type="button"
            key={tab.path}
            onClick={() => void useWorkspaceStore.getState().activateTab(index)}
            onAuxClick={(e) => {
              if (e.button === 1) void useWorkspaceStore.getState().closeTabAt(index)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, tabIndex: index })
            }}
            className={`flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 text-[12px] ${
              active
                ? 'border-caret bg-primary text-white'
                : 'border-transparent text-fg-dim hover:text-fg'
            } ${tab.external ? 'bg-external' : ''}`}
            title={tab.path}
          >
            <span>{name}</span>
            {dirty && <span className="h-1.5 w-1.5 rounded-full bg-caret" />}
          </button>
        )
      })}

      {menu && (
        <div
          style={{ left: menu.x, top: menu.y }}
          className="fixed z-50 min-w-40 rounded-md border border-edge bg-secondary py-1 shadow-[0_8px_30px_rgba(0,0,0,.4)]"
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
              className="block w-full cursor-pointer px-3 py-1 text-left text-[12px] hover:bg-hover"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
