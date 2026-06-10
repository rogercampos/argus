import { describe, expect, it } from 'vitest'
import { closeOtherTabs, closeTab, cycleTab, openTab, type TabsState, tabToEvict } from './tabs'

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
