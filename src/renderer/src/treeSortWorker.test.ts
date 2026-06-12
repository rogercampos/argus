import { beforeAll, describe, expect, it } from 'vitest'

/** The worker module wires self.onmessage; in jsdom `self` is the window. */
type WorkerScope = {
  onmessage: ((event: { data: unknown }) => void) | null
  postMessage: (message: unknown) => void
}
const scope = globalThis as unknown as WorkerScope

const posted: Array<{ id: number; sorted: string[] }> = []

beforeAll(async () => {
  scope.postMessage = (message) => {
    posted.push(message as (typeof posted)[number])
  }
  await import('./treeSortWorker')
})

describe('tree sort worker protocol', () => {
  it('sorts paths into tree order, starred folders first', () => {
    scope.onmessage?.({
      data: { id: 3, paths: ['zeta/x.ts', 'alpha/y.ts', 'top.ts'], starred: ['zeta'] }
    })
    expect(posted).toHaveLength(1)
    expect(posted[0].id).toBe(3)
    expect(posted[0].sorted).toEqual(['zeta/x.ts', 'alpha/y.ts', 'top.ts'])
  })
})
