import { beforeAll, describe, expect, it } from 'vitest'
import { createTestApi, installTestApi, type TestApi } from '../../../test/apiAdapter'
import { makeFixtureRepo } from '../../../test/fixtures'
import type { ProcStatsSnapshot } from '../../shared/types'
import { useProcStore } from './procStore'
import { useTasksStore } from './tasksStore'

describe('tasks store (spec 10)', () => {
  let testApi: TestApi

  beforeAll(() => {
    const repo = makeFixtureRepo()
    testApi = createTestApi(repo.root)
    installTestApi(testApi)
    useTasksStore.getState().init()
    useProcStore.getState().init()
  })

  it('tracks the queued → started → progress → finished lifecycle', () => {
    testApi.emitTaskUpdate({ id: 1, status: 'queued', name: 'Indexing' })
    expect(useTasksStore.getState().tasks).toEqual([
      { id: 1, name: 'Indexing', message: undefined, percentage: undefined, state: 'queued' }
    ])

    testApi.emitTaskUpdate({ id: 1, status: 'started', name: 'Indexing' })
    expect(useTasksStore.getState().tasks[0].state).toBe('active')

    testApi.emitTaskUpdate({
      id: 1,
      status: 'progress',
      name: 'Indexing',
      message: '50/100',
      percentage: 50
    })
    expect(useTasksStore.getState().tasks[0]).toMatchObject({ message: '50/100', percentage: 50 })

    testApi.emitTaskUpdate({ id: 2, status: 'started', name: 'Other job' })
    expect(useTasksStore.getState().tasks).toHaveLength(2)

    testApi.emitTaskUpdate({ id: 1, status: 'finished', name: 'Indexing' })
    expect(useTasksStore.getState().tasks.map((t) => t.id)).toEqual([2])
  })

  it('closes the popup when the last task finishes', () => {
    useTasksStore.getState().togglePopup()
    expect(useTasksStore.getState().popupVisible).toBe(true)
    testApi.emitTaskUpdate({ id: 2, status: 'finished', name: 'Other job' })
    expect(useTasksStore.getState().tasks).toEqual([])
    expect(useTasksStore.getState().popupVisible).toBe(false)
  })

  it('proc store keeps the latest snapshot', () => {
    const snapshot: ProcStatsSnapshot = {
      at: 1,
      entries: [],
      activity: [],
      app: [],
      totals: { cpu: 0, memBytes: 0, count: 0 }
    }
    testApi.emitProcStats(snapshot)
    expect(useProcStore.getState().snapshot).toEqual(snapshot)
    useProcStore.getState().togglePopup()
    expect(useProcStore.getState().popupVisible).toBe(true)
  })
})
