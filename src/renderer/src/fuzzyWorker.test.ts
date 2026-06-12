import { beforeAll, describe, expect, it } from 'vitest'
import type { RankedItem } from './fuzzy'

/** The worker module wires self.onmessage; in jsdom `self` is the window. */
type WorkerScope = {
  onmessage: ((event: { data: unknown }) => void) | null
  postMessage: (message: unknown) => void
}
const scope = globalThis as unknown as WorkerScope

const posted: Array<{ type: string; id: number; items: RankedItem[]; total: number }> = []

beforeAll(async () => {
  scope.postMessage = (message) => {
    posted.push(message as (typeof posted)[number])
  }
  await import('./fuzzyWorker')
})

describe('fuzzy worker protocol (spec 04)', () => {
  it('stores the path list on set and answers queries by id', () => {
    scope.onmessage?.({
      data: { type: 'set', paths: ['src/app.ts', 'lib/needle.ts', 'README.md'] }
    })
    expect(posted).toEqual([])

    scope.onmessage?.({
      data: { type: 'query', id: 7, query: 'needle', recents: [], limit: 10 }
    })
    expect(posted).toHaveLength(1)
    expect(posted[0].type).toBe('result')
    expect(posted[0].id).toBe(7)
    expect(posted[0].total).toBe(1)
    expect(posted[0].items[0].path).toBe('lib/needle.ts')
  })

  it('an empty query lists everything (recents first)', () => {
    posted.length = 0
    scope.onmessage?.({
      data: { type: 'query', id: 8, query: '', recents: ['README.md'], limit: 10 }
    })
    expect(posted[0].total).toBe(3)
    expect(posted[0].items[0].path).toBe('README.md')
  })
})
