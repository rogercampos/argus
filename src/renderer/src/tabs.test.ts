import { describe, expect, it } from 'vitest'
import {
  closeOtherTabs,
  closeSavedTabs,
  closeTab,
  closeTabsToLeft,
  closeTabsToRight,
  closeUnpinnedTabs,
  cycleTab,
  duplicateNameHints,
  moveTab,
  openTab,
  type TabsState,
  tabToEvict,
  togglePinned
} from './tabs'

const t = (...paths: string[]): TabsState => ({
  tabs: paths.map((path) => ({ path, external: false })),
  activeIndex: 0
})

describe('tab ordering rules (spec 06)', () => {
  it('first tab opens at index 0 and activates', () => {
    const s = openTab({ tabs: [], activeIndex: 0 }, 'a.ts')
    expect(s.tabs.map((x) => x.path)).toEqual(['a.ts'])
    expect(s.activeIndex).toBe(0)
  })

  it('new tab inserts immediately after the active tab', () => {
    let s = t('a.ts', 'b.ts', 'c.ts')
    s = { ...s, activeIndex: 1 }
    s = openTab(s, 'new.ts')
    expect(s.tabs.map((x) => x.path)).toEqual(['a.ts', 'b.ts', 'new.ts', 'c.ts'])
    expect(s.activeIndex).toBe(2)
  })

  it('re-opening an open file moves its tab next to the active tab', () => {
    let s = t('a.ts', 'b.ts', 'c.ts', 'd.ts')
    s = { ...s, activeIndex: 0 } // active: a.ts
    s = openTab(s, 'd.ts')
    expect(s.tabs.map((x) => x.path)).toEqual(['a.ts', 'd.ts', 'b.ts', 'c.ts'])
    expect(s.activeIndex).toBe(1)
  })

  it('re-opening the active tab is a no-op', () => {
    const s = t('a.ts', 'b.ts')
    expect(openTab(s, 'a.ts')).toBe(s)
  })

  it('closing the active tab activates the nearest remaining tab', () => {
    let s = t('a.ts', 'b.ts', 'c.ts')
    s = { ...s, activeIndex: 2 }
    s = closeTab(s, 2)
    expect(s.tabs.map((x) => x.path)).toEqual(['a.ts', 'b.ts'])
    expect(s.activeIndex).toBe(1)
  })

  it('closing a tab before the active one shifts the active index', () => {
    let s = t('a.ts', 'b.ts', 'c.ts')
    s = { ...s, activeIndex: 2 }
    s = closeTab(s, 0)
    expect(s.activeIndex).toBe(1)
    expect(s.tabs[s.activeIndex].path).toBe('c.ts')
  })

  it('close others keeps only the given tab', () => {
    const s = closeOtherTabs(t('a.ts', 'b.ts', 'c.ts'), 1)
    expect(s.tabs.map((x) => x.path)).toEqual(['b.ts'])
    expect(s.activeIndex).toBe(0)
  })

  it('cycling wraps in both directions', () => {
    let s = t('a.ts', 'b.ts', 'c.ts')
    s = cycleTab(s, -1)
    expect(s.activeIndex).toBe(2)
    s = cycleTab(s, 1)
    expect(s.activeIndex).toBe(0)
    expect(cycleTab(t('only.ts'), 1).activeIndex).toBe(0)
  })

  it('evicts the least-recently-used tab, never the active one', () => {
    const paths = Array.from({ length: 51 }, (_, i) => `f${i}.ts`)
    const s: TabsState = { tabs: paths.map((path) => ({ path, external: false })), activeIndex: 50 }
    // recency: f50 most recent ... f0 oldest; f0 should evict
    const recency = [...paths].reverse()
    expect(tabToEvict(s, recency)).toBe(0)
  })

  it('does not evict under the cap', () => {
    expect(tabToEvict(t('a.ts', 'b.ts'), ['a.ts', 'b.ts'])).toBe(-1)
  })

  it('files missing from recency evict first', () => {
    const paths = Array.from({ length: 51 }, (_, i) => `f${i}.ts`)
    const s: TabsState = { tabs: paths.map((path) => ({ path, external: false })), activeIndex: 0 }
    const recency = paths.filter((p) => p !== 'f33.ts')
    expect(tabToEvict(s, recency)).toBe(33)
  })
})

/** `p:` prefix marks a pinned tab */
const tp = (active: number, ...paths: string[]): TabsState => ({
  tabs: paths.map((p) =>
    p.startsWith('p:')
      ? { path: p.slice(2), external: false, pinned: true }
      : { path: p, external: false }
  ),
  activeIndex: active
})
const names = (s: TabsState): string[] => s.tabs.map((x) => (x.pinned ? `p:${x.path}` : x.path))
const active = (s: TabsState): string | undefined => s.tabs[s.activeIndex]?.path

describe('bulk closes', () => {
  it('close to the right/left keeps the clicked tab and activates it if needed', () => {
    let s = closeTabsToRight(tp(3, 'a', 'b', 'c', 'd'), 1)
    expect(names(s)).toEqual(['a', 'b'])
    expect(active(s)).toBe('b')

    s = closeTabsToLeft(tp(3, 'a', 'b', 'c', 'd'), 2)
    expect(names(s)).toEqual(['c', 'd'])
    expect(active(s)).toBe('d') // active survived
  })

  it('closing nothing returns the same state', () => {
    const s = tp(0, 'a', 'b')
    expect(closeTabsToRight(s, 1)).toBe(s)
  })

  it('close saved keeps dirty tabs', () => {
    const s = closeSavedTabs(tp(0, 'a', 'b', 'c'), (p) => p === 'b')
    expect(names(s)).toEqual(['b'])
    expect(active(s)).toBe('b')
  })

  it('bulk closes skip pinned tabs', () => {
    expect(names(closeOtherTabs(tp(0, 'p:a', 'b', 'c'), 2))).toEqual(['p:a', 'c'])
    expect(names(closeTabsToRight(tp(0, 'p:a', 'p:b', 'c'), 0))).toEqual(['p:a', 'p:b'])
    expect(names(closeTabsToLeft(tp(2, 'p:a', 'b', 'c'), 2))).toEqual(['p:a', 'c'])
    const all = closeUnpinnedTabs(tp(2, 'p:a', 'b', 'c'))
    expect(names(all)).toEqual(['p:a'])
    expect(active(all)).toBe('a')
    // an explicit close still closes a pinned tab
    expect(names(closeTab(tp(0, 'p:a', 'b'), 0))).toEqual(['b'])
  })
})

describe('pinned tabs', () => {
  it('pinning moves the tab to the end of the pinned block and keeps focus', () => {
    const s = togglePinned(tp(1, 'p:a', 'b', 'c'), 2)
    expect(names(s)).toEqual(['p:a', 'p:c', 'b'])
    expect(active(s)).toBe('b')
  })

  it('unpinning moves the tab to the start of the unpinned tabs', () => {
    const s = togglePinned(tp(0, 'p:a', 'p:b', 'c'), 0)
    expect(names(s)).toEqual(['p:b', 'a', 'c'])
    expect(active(s)).toBe('a')
  })

  it('new tabs never open inside the pinned block', () => {
    const s = openTab(tp(0, 'p:a', 'p:b', 'c'), 'new')
    expect(names(s)).toEqual(['p:a', 'p:b', 'new', 'c'])
    expect(active(s)).toBe('new')
  })

  it('re-opening a pinned tab focuses it in place', () => {
    const s = openTab(tp(2, 'p:a', 'b', 'c'), 'a')
    expect(names(s)).toEqual(['p:a', 'b', 'c'])
    expect(s.activeIndex).toBe(0)
  })

  it('re-opening an unpinned tab from a pinned one lands after the pinned block', () => {
    const s = openTab(tp(0, 'p:a', 'p:b', 'c', 'd'), 'd')
    expect(names(s)).toEqual(['p:a', 'p:b', 'd', 'c'])
    expect(active(s)).toBe('d')
  })

  it('eviction skips pinned tabs', () => {
    const paths = Array.from({ length: 51 }, (_, i) => `f${i}.ts`)
    const s: TabsState = {
      tabs: paths.map((path, i) => ({ path, external: false, pinned: i === 0 || undefined })),
      activeIndex: 50
    }
    expect(tabToEvict(s, [...paths].reverse())).toBe(1)
  })
})

describe('moveTab', () => {
  it('reorders and keeps the same tab active', () => {
    const s = moveTab(tp(0, 'a', 'b', 'c'), 0, 2)
    expect(names(s)).toEqual(['b', 'c', 'a'])
    expect(active(s)).toBe('a')
  })

  it('clamps each tab to its own zone', () => {
    expect(names(moveTab(tp(0, 'p:a', 'b', 'c'), 2, 0))).toEqual(['p:a', 'c', 'b'])
    expect(names(moveTab(tp(0, 'p:a', 'p:b', 'c'), 0, 2))).toEqual(['p:b', 'p:a', 'c'])
  })
})

describe('duplicateNameHints', () => {
  it('only hints duplicated names, with the shortest unique parent suffix', () => {
    expect(
      duplicateNameHints(['src/lib/index.ts', 'test/lib/index.ts', 'src/app/index.ts', 'README.md'])
    ).toEqual(['src/lib', 'test/lib', 'app', null])
  })

  it('marks a root-level file', () => {
    expect(duplicateNameHints(['index.ts', 'src/index.ts'])).toEqual(['/', 'src'])
  })
})
