import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatAccelerator, type ShortcutCommandId } from '../../../shared/shortcuts'
import { useKeymapStore } from '../keymapStore'
import { useWorkspaceStore } from '../store'
import { duplicateNameHints, type TabEntry } from '../tabs'
import { FileIcon } from './FileIcon'

interface ContextMenuState {
  x: number
  y: number
  tabIndex: number
}

interface DropTarget {
  index: number
  side: 'before' | 'after'
}

export function PinGlyph({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`size-3 ${className}`}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M10.5 1.5 14.5 5.5 13.1 6.2 10.9 8.4 10.6 11.6 9.5 12.7 7 10.2 3.2 14 2 14 2 12.8 5.8 9 3.3 6.5 4.4 5.4 7.6 5.1 9.8 2.9Z" />
    </svg>
  )
}

function ChevronDownGlyph(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  )
}

export function EditorTabs(): React.JSX.Element | null {
  const tabs = useWorkspaceStore((s) => s.tabs)
  const dirtyPaths = useWorkspaceStore((s) => s.dirtyPaths)
  const bindings = useKeymapStore((s) => s.bindings)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const dragIndex = useRef<number | null>(null)
  const tabRefs = useRef(new Map<string, HTMLDivElement>())

  const hints = useMemo(() => duplicateNameHints(tabs.tabs.map((t) => t.path)), [tabs.tabs])
  const activePath = tabs.tabs[tabs.activeIndex]?.path

  useEffect(() => {
    if (!menu) return undefined
    const close = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  // keep the active tab visible when it changes (open, cycle, list pick)
  useEffect(() => {
    if (!activePath) return
    tabRefs.current.get(activePath)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activePath])

  if (tabs.tabs.length === 0) return null

  const store = useWorkspaceStore.getState
  const shortcut = (id: ShortcutCommandId): string => formatAccelerator(bindings[id] ?? null)

  const onDrop = (): void => {
    const from = dragIndex.current
    dragIndex.current = null
    setDropTarget(null)
    if (from === null || !dropTarget) return
    let to = dropTarget.index + (dropTarget.side === 'after' ? 1 : 0)
    if (from < to) to -= 1
    store().moveTab(from, to)
  }

  return (
    <div className="flex h-(--size-tabstrip) shrink-0 border-b border-edge bg-secondary">
      <div
        className="flex min-w-0 flex-1 items-end overflow-x-auto [scrollbar-width:none]"
        onWheel={(e) => {
          // a plain mouse wheel scrolls the strip sideways
          if (e.deltaX === 0 && e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY
        }}
      >
        {tabs.tabs.map((tab, index) => {
          const name = tab.path.split('/').pop()
          const hint = hints[index]
          const active = index === tabs.activeIndex
          const dirty = dirtyPaths[tab.path]
          const drop = dropTarget?.index === index ? dropTarget.side : null
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: drag-to-reorder target; the inner buttons carry the keyboard interactions
            <div
              key={tab.path}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.path, el)
                else tabRefs.current.delete(tab.path)
              }}
              data-tab-path={tab.path}
              draggable
              onDragStart={(e) => {
                dragIndex.current = index
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', tab.path)
              }}
              onDragOver={(e) => {
                if (dragIndex.current === null) return
                e.preventDefault()
                const rect = e.currentTarget.getBoundingClientRect()
                const side = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
                if (drop !== side) setDropTarget({ index, side })
              }}
              onDrop={(e) => {
                e.preventDefault()
                onDrop()
              }}
              onDragEnd={() => {
                dragIndex.current = null
                setDropTarget(null)
              }}
              className={`group flex h-full shrink-0 items-center border-b-2 ${
                active
                  ? 'border-caret bg-primary text-white'
                  : 'border-transparent text-fg-dim hover:text-fg'
              } ${tab.external ? 'bg-external' : ''} ${
                drop === 'before'
                  ? 'shadow-[inset_2px_0_0_var(--color-caret)]'
                  : drop === 'after'
                    ? 'shadow-[inset_-2px_0_0_var(--color-caret)]'
                    : ''
              }`}
            >
              <button
                type="button"
                onClick={() => void store().activateTab(index)}
                onAuxClick={(e) => {
                  if (e.button === 1) void store().closeTabAt(index)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  // keyboard-invoked (menu key / ⇧F10) events carry no pointer
                  // position: anchor under the tab instead
                  const rect = e.currentTarget.getBoundingClientRect()
                  const fromKeyboard = e.clientX === 0 && e.clientY === 0
                  setMenu({
                    x: fromKeyboard ? rect.left : e.clientX,
                    y: fromKeyboard ? rect.bottom : e.clientY,
                    tabIndex: index
                  })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'F10' && e.shiftKey) {
                    e.preventDefault()
                    const rect = e.currentTarget.getBoundingClientRect()
                    setMenu({ x: rect.left, y: rect.bottom, tabIndex: index })
                  }
                }}
                className="focus-ring -outline-offset-2 flex h-full cursor-pointer items-center gap-1.5 pl-3 text-chrome"
                title={tab.path}
              >
                <FileIcon path={tab.path} />
                <span>{name}</span>
                {hint && <span className="text-label text-fg-dim">{hint}</span>}
              </button>
              <TabEndButton tab={tab} index={index} active={active} dirty={Boolean(dirty)} />
            </div>
          )
        })}
      </div>

      <button
        type="button"
        title={`Show all open tabs${shortcut('show-open-tabs') ? ` (${shortcut('show-open-tabs')})` : ''}`}
        onClick={() => store().setModal('open-tabs')}
        className="focus-ring -outline-offset-2 flex shrink-0 cursor-pointer items-center justify-center gap-0.5 border-l px-2 border-edge text-label text-fg-dim hover:bg-hover hover:text-fg"
      >
        <span className="tabular-nums">{tabs.tabs.length}</span>
        <ChevronDownGlyph />
      </button>

      {menu && (
        <TabContextMenu
          menu={menu}
          tabs={tabs.tabs}
          dirtyPaths={dirtyPaths}
          shortcut={shortcut}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

/** Close button; the dirty dot doubles as it (RubyMine-style) and a pinned
 * tab shows a pin that unpins on click (VS Code-style). */
function TabEndButton({
  tab,
  index,
  active,
  dirty
}: {
  tab: TabEntry
  index: number
  active: boolean
  dirty: boolean
}): React.JSX.Element {
  const store = useWorkspaceStore.getState
  if (tab.pinned) {
    return (
      <button
        type="button"
        title="Unpin tab"
        onClick={(e) => {
          e.stopPropagation()
          store().togglePinTab(index)
        }}
        className={`focus-ring -outline-offset-2 flex h-full w-6 cursor-pointer items-center justify-center ${
          dirty
            ? 'text-caret hover:text-fg [&>.dot]:group-hover:hidden [&>.pin]:hidden [&>.pin]:group-hover:block'
            : 'text-fg-dim hover:text-fg'
        }`}
      >
        {dirty && (
          <span className="dot h-1.5 w-1.5 rounded-full bg-caret" title="Unsaved changes" />
        )}
        <PinGlyph className="pin" />
      </button>
    )
  }
  return (
    <button
      type="button"
      title="Close tab"
      onClick={(e) => {
        e.stopPropagation()
        void store().closeTabAt(index)
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
  )
}

type MenuEntry =
  | 'separator'
  | { label: string; action: () => unknown; enabled?: boolean; shortcut?: ShortcutCommandId }

function TabContextMenu({
  menu,
  tabs,
  dirtyPaths,
  shortcut,
  onClose
}: {
  menu: ContextMenuState
  tabs: TabEntry[]
  dirtyPaths: Record<string, boolean>
  shortcut: (id: ShortcutCommandId) => string
  onClose: () => void
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: menu.x, top: menu.y })

  // keep the menu inside the window; move focus in for keyboard use
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.querySelector<HTMLButtonElement>('[role="menuitem"]:enabled')?.focus()
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(4, Math.min(menu.x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(menu.y, window.innerHeight - height - 4))
    })
  }, [menu.x, menu.y])

  const index = menu.tabIndex
  const tab = tabs[index]
  if (!tab) return null
  const store = useWorkspaceStore.getState
  const closable = (i: number): boolean => !tabs[i].pinned
  const any = (pred: (i: number) => boolean): boolean => tabs.some((_, i) => pred(i))

  const entries: MenuEntry[] = [
    { label: 'Close', action: () => store().closeTabAt(index), shortcut: 'close-tab' },
    {
      label: 'Close Other Tabs',
      action: () => store().closeOthers(index),
      enabled: any((i) => i !== index && closable(i)),
      shortcut: 'close-other-tabs'
    },
    {
      label: 'Close Tabs to the Right',
      action: () => store().closeTabsToRight(index),
      enabled: any((i) => i > index && closable(i))
    },
    {
      label: 'Close Tabs to the Left',
      action: () => store().closeTabsToLeft(index),
      enabled: any((i) => i < index && closable(i))
    },
    {
      label: 'Close Saved Tabs',
      action: () => store().closeSavedTabs(),
      enabled: any((i) => closable(i) && !dirtyPaths[tabs[i].path]),
      shortcut: 'close-saved-tabs'
    },
    {
      label: 'Close All Tabs',
      action: () => store().closeAllTabs(),
      enabled: any(closable),
      shortcut: 'close-all-tabs'
    },
    'separator',
    {
      label: tab.pinned ? 'Unpin Tab' : 'Pin Tab',
      action: () => store().togglePinTab(index),
      shortcut: 'toggle-pin-tab'
    },
    'separator',
    {
      label: 'Copy Path',
      action: () =>
        window.api.copyToClipboard(
          tab.path.startsWith('/') ? tab.path : `${store().rootPath}/${tab.path}`
        )
    },
    {
      label: 'Copy Relative Path',
      action: () => window.api.copyToClipboard(tab.path),
      shortcut: 'copy-relative-path'
    },
    {
      label: 'Reveal in File Tree',
      action: async () => {
        await store().activateTab(index)
        store().revealActiveFile()
      },
      enabled: !tab.path.startsWith('/'),
      shortcut: 'reveal-active-file'
    }
  ]

  return (
    <div
      ref={ref}
      role="menu"
      style={pos}
      className="fixed z-50 min-w-56 rounded-md border border-edge bg-secondary py-1 shadow-popover"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        e.preventDefault()
        const items = [
          ...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:enabled') ?? [])
        ]
        const at = items.indexOf(document.activeElement as HTMLButtonElement)
        const step = e.key === 'ArrowDown' ? 1 : -1
        items[(at + step + items.length) % items.length]?.focus()
      }}
    >
      {entries.map((entry, i) =>
        entry === 'separator' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static separators
          <div key={`sep-${i}`} className="my-1 border-t border-edge" />
        ) : (
          <button
            type="button"
            role="menuitem"
            key={entry.label}
            disabled={entry.enabled === false}
            onClick={() => {
              onClose()
              void entry.action()
            }}
            className="focus-ring -outline-offset-2 flex w-full cursor-pointer items-center gap-6 px-3 py-1 text-left text-chrome enabled:hover:bg-hover disabled:cursor-default disabled:opacity-50"
          >
            <span className="flex-1">{entry.label}</span>
            {entry.shortcut && shortcut(entry.shortcut) && (
              <span className="text-label text-fg-dim">{shortcut(entry.shortcut)}</span>
            )}
          </button>
        )
      )}
    </div>
  )
}
