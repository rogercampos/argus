import { describe, expect, it } from 'vitest'
import { type HistoryLocation, JumpHistory } from './history'

const loc = (path: string, cursorOffset = 0): HistoryLocation => ({
  path,
  cursorOffset,
  scrollTop: 0
})

describe('JumpHistory (spec 05)', () => {
  it('back returns the previous location, saving the current head', () => {
    const h = new JumpHistory()
    h.record(loc('a.ts'))
    h.record(loc('b.ts'))
    const back = h.back(loc('c.ts')) // currently at c.ts (not yet recorded)
    expect(back?.path).toBe('b.ts')
  })

  it('forward returns to where back came from', () => {
    const h = new JumpHistory()
    h.record(loc('a.ts'))
    h.back(loc('b.ts'))
    expect(h.forward()?.path).toBe('b.ts')
    expect(h.forward()).toBeNull()
  })

  it('back at the beginning returns null', () => {
    const h = new JumpHistory()
    expect(h.back(loc('a.ts'))).toBeNull()
    h.record(loc('a.ts'))
    expect(h.back(loc('a.ts'))).toBeNull()
  })

  it('does not record consecutive duplicates', () => {
    const h = new JumpHistory()
    h.record(loc('a.ts', 5))
    h.record(loc('a.ts', 5))
    expect(h.size()).toBe(1)
  })

  it('recording after back truncates forward history', () => {
    const h = new JumpHistory()
    h.record(loc('a.ts'))
    h.record(loc('b.ts'))
    h.back(loc('c.ts'))
    h.record(loc('d.ts'))
    expect(h.forward()).toBeNull()
    const back = h.back(loc('d.ts'))
    expect(back?.path).toBe('b.ts')
  })

  it('walks a realistic chain', () => {
    const h = new JumpHistory()
    // user navigates a -> b -> c, recording departures
    h.record(loc('a.ts')) // leaving a
    h.record(loc('b.ts')) // leaving b
    // now at c
    expect(h.back(loc('c.ts'))?.path).toBe('b.ts')
    expect(h.back(loc('b.ts'))?.path).toBe('a.ts')
    expect(h.forward()?.path).toBe('b.ts')
    expect(h.forward()?.path).toBe('c.ts')
  })
})
