/**
 * Editor tab ordering rules (spec 06), as pure functions so they are
 * directly testable.
 *
 * Pinned tabs always form a contiguous block at the start of the strip; bulk
 * closes (others/left/right/saved/all) and LRU eviction skip them.
 */

export interface TabEntry {
  path: string
  external: boolean
  pinned?: boolean
}

export const MAX_OPEN_TABS = 50

export interface TabsState {
  tabs: TabEntry[]
  activeIndex: number
}

function pinnedCount(tabs: TabEntry[]): number {
  let n = 0
  while (n < tabs.length && tabs[n].pinned) n++
  return n
}

/**
 * Open `path` per spec 06:
 * - already open: focus it AND move it to sit immediately after the
 *   previously active tab (unless it is the active tab already, or pinned —
 *   pinned tabs keep their place)
 * - new: insert immediately after the active tab (never inside the pinned
 *   block) and focus it
 */
export function openTab(state: TabsState, path: string, external = false): TabsState {
  const { tabs, activeIndex } = state
  const existingIndex = tabs.findIndex((t) => t.path === path)

  if (existingIndex === activeIndex && existingIndex !== -1) return state

  if (existingIndex !== -1) {
    if (tabs[existingIndex].pinned) return { tabs, activeIndex: existingIndex }
    const next = [...tabs]
    const [entry] = next.splice(existingIndex, 1)
    // position right after the (possibly shifted) active tab
    const anchor = next.findIndex((t) => t.path === tabs[activeIndex]?.path)
    const insertAt = Math.max(anchor === -1 ? next.length : anchor + 1, pinnedCount(next))
    next.splice(insertAt, 0, entry)
    return { tabs: next, activeIndex: insertAt }
  }

  const insertAt = tabs.length === 0 ? 0 : Math.max(activeIndex + 1, pinnedCount(tabs))
  const next = [...tabs]
  next.splice(insertAt, 0, { path, external })
  return { tabs: next, activeIndex: insertAt }
}

/**
 * Close every tab for which `shouldClose` holds. If the active tab survives it
 * stays active; otherwise `preferIndex` (when it survives), else the nearest
 * survivor to the right of the old active tab, else the one to its left.
 */
export function closeTabsWhere(
  state: TabsState,
  shouldClose: (tab: TabEntry, index: number) => boolean,
  preferIndex?: number
): TabsState {
  const keep = state.tabs.map((tab, i) => !shouldClose(tab, i))
  const next = state.tabs.filter((_, i) => keep[i])
  if (next.length === state.tabs.length) return state
  if (next.length === 0) return { tabs: [], activeIndex: 0 }

  const newIndexOf = (oldIndex: number): number => keep.slice(0, oldIndex).filter(Boolean).length

  let target = -1
  if (keep[state.activeIndex]) target = state.activeIndex
  else if (preferIndex !== undefined && keep[preferIndex]) target = preferIndex
  else {
    for (let i = state.activeIndex + 1; i < keep.length && target === -1; i++) {
      if (keep[i]) target = i
    }
    for (let i = state.activeIndex - 1; i >= 0 && target === -1; i--) {
      if (keep[i]) target = i
    }
  }
  return { tabs: next, activeIndex: newIndexOf(target) }
}

/** Close the tab at `index`; activates the nearest remaining tab. */
export function closeTab(state: TabsState, index: number): TabsState {
  return closeTabsWhere(state, (_, i) => i === index)
}

/** Close all unpinned tabs except `index`, which becomes active. */
export function closeOtherTabs(state: TabsState, index: number): TabsState {
  return closeTabsWhere(state, (t, i) => i !== index && !t.pinned, index)
}

export function closeTabsToRight(state: TabsState, index: number): TabsState {
  return closeTabsWhere(state, (t, i) => i > index && !t.pinned, index)
}

export function closeTabsToLeft(state: TabsState, index: number): TabsState {
  return closeTabsWhere(state, (t, i) => i < index && !t.pinned, index)
}

/** Close unpinned tabs without unsaved changes. */
export function closeSavedTabs(state: TabsState, isDirty: (path: string) => boolean): TabsState {
  return closeTabsWhere(state, (t) => !t.pinned && !isDirty(t.path))
}

export function closeUnpinnedTabs(state: TabsState): TabsState {
  return closeTabsWhere(state, (t) => !t.pinned)
}

/**
 * Move the tab at `from` so it lands at `to` (an index in the resulting
 * list), clamped to its own zone: a pinned tab stays within the pinned
 * block, an unpinned one after it. The same tab stays active.
 */
export function moveTab(state: TabsState, from: number, to: number): TabsState {
  const { tabs } = state
  const entry = tabs[from]
  if (!entry) return state
  const rest = tabs.filter((_, i) => i !== from)
  const pinned = pinnedCount(rest)
  const [min, max] = entry.pinned ? [0, pinned] : [pinned, rest.length]
  const insertAt = Math.min(Math.max(to, min), max)
  if (insertAt === from) return state
  const activePath = tabs[state.activeIndex]?.path
  const next = [...rest]
  next.splice(insertAt, 0, entry)
  return {
    tabs: next,
    activeIndex: Math.max(
      0,
      next.findIndex((t) => t.path === activePath)
    )
  }
}

/** Pin (move to the end of the pinned block) or unpin (move to the start of
 * the unpinned tabs) the tab at `index`. */
export function togglePinned(state: TabsState, index: number): TabsState {
  const entry = state.tabs[index]
  if (!entry) return state
  const activePath = state.tabs[state.activeIndex]?.path
  const rest = state.tabs.filter((_, i) => i !== index)
  const next = [...rest]
  next.splice(pinnedCount(rest), 0, { ...entry, pinned: !entry.pinned || undefined })
  return {
    tabs: next,
    activeIndex: Math.max(
      0,
      next.findIndex((t) => t.path === activePath)
    )
  }
}

/** Cycle to the next/previous tab, wrapping (spec 06). */
export function cycleTab(state: TabsState, delta: 1 | -1): TabsState {
  if (state.tabs.length === 0) return state
  const n = state.tabs.length
  return { ...state, activeIndex: (state.activeIndex + delta + n) % n }
}

/**
 * If over the cap, pick the tab to evict: the least-recently-used open tab
 * per `recency` (most recent first), never the active or a pinned tab.
 * Returns the index to evict or -1.
 */
export function tabToEvict(state: TabsState, recency: string[]): number {
  if (state.tabs.length <= MAX_OPEN_TABS) return -1
  const rank = new Map(recency.map((p, i) => [p, i]))
  let worstIndex = -1
  let worstRank = -1
  for (let i = 0; i < state.tabs.length; i++) {
    if (i === state.activeIndex || state.tabs[i].pinned) continue
    const r = rank.get(state.tabs[i].path) ?? Number.MAX_SAFE_INTEGER
    if (r > worstRank) {
      worstRank = r
      worstIndex = i
    }
  }
  return worstIndex
}

/**
 * Directory hints that tell apart open files sharing a basename: the
 * shortest trailing run of parent directories that is unique within the
 * group (e.g. `lib` vs `test/lib`). `null` for files with a unique name.
 */
export function duplicateNameHints(paths: string[]): Array<string | null> {
  const dirsOf = paths.map((p) => p.split('/').filter(Boolean).slice(0, -1))
  const groups = new Map<string, number[]>()
  paths.forEach((p, i) => {
    const name = p.split('/').pop() ?? p
    groups.set(name, [...(groups.get(name) ?? []), i])
  })

  const hints: Array<string | null> = paths.map(() => null)
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const maxDepth = Math.max(...members.map((i) => dirsOf[i].length))
    for (const i of members) {
      const dirs = dirsOf[i]
      let hint = dirs.join('/')
      for (let depth = 1; depth <= maxDepth; depth++) {
        const suffix = (j: number): string => dirsOf[j].slice(-depth).join('/')
        const mine = suffix(i)
        if (members.every((j) => j === i || suffix(j) !== mine)) {
          hint = mine
          break
        }
      }
      hints[i] = hint || '/'
    }
  }
  return hints
}
