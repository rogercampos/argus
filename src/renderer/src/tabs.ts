/**
 * Editor tab ordering rules (spec 06), as pure functions so they are
 * directly testable.
 */

export interface TabEntry {
  path: string
  external: boolean
}

export const MAX_OPEN_TABS = 50

export interface TabsState {
  tabs: TabEntry[]
  activeIndex: number
}

/**
 * Open `path` per spec 06:
 * - already open: focus it AND move it to sit immediately after the
 *   previously active tab (unless it is the active tab already)
 * - new: insert immediately after the active tab and focus it
 */
export function openTab(state: TabsState, path: string, external = false): TabsState {
  const { tabs, activeIndex } = state
  const existingIndex = tabs.findIndex((t) => t.path === path)

  if (existingIndex === activeIndex && existingIndex !== -1) return state

  if (existingIndex !== -1) {
    const next = [...tabs]
    const [entry] = next.splice(existingIndex, 1)
    // position right after the (possibly shifted) active tab
    const anchor = next.findIndex((t) => t.path === tabs[activeIndex]?.path)
    const insertAt = anchor === -1 ? next.length : anchor + 1
    next.splice(insertAt, 0, entry)
    return { tabs: next, activeIndex: insertAt }
  }

  const insertAt = tabs.length === 0 ? 0 : activeIndex + 1
  const next = [...tabs]
  next.splice(insertAt, 0, { path, external })
  return { tabs: next, activeIndex: insertAt }
}

/** Close the tab at `index`; activates the nearest remaining tab. */
export function closeTab(state: TabsState, index: number): TabsState {
  const next = state.tabs.filter((_, i) => i !== index)
  if (next.length === 0) return { tabs: [], activeIndex: 0 }
  let active = state.activeIndex
  if (index < active) active -= 1
  else if (index === active) active = Math.min(active, next.length - 1)
  return { tabs: next, activeIndex: active }
}

export function closeOtherTabs(state: TabsState, index: number): TabsState {
  return { tabs: [state.tabs[index]], activeIndex: 0 }
}

/** Cycle to the next/previous tab, wrapping (spec 06). */
export function cycleTab(state: TabsState, delta: 1 | -1): TabsState {
  if (state.tabs.length === 0) return state
  const n = state.tabs.length
  return { ...state, activeIndex: (state.activeIndex + delta + n) % n }
}

/**
 * If over the cap, pick the tab to evict: the least-recently-used open tab
 * per `recency` (most recent first), never the active tab. Returns the
 * index to evict or -1.
 */
export function tabToEvict(state: TabsState, recency: string[]): number {
  if (state.tabs.length <= MAX_OPEN_TABS) return -1
  const rank = new Map(recency.map((p, i) => [p, i]))
  let worstIndex = -1
  let worstRank = -1
  for (let i = 0; i < state.tabs.length; i++) {
    if (i === state.activeIndex) continue
    const r = rank.get(state.tabs[i].path) ?? Number.MAX_SAFE_INTEGER
    if (r > worstRank) {
      worstRank = r
      worstIndex = i
    }
  }
  return worstIndex
}
