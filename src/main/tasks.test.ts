import type { BrowserWindow } from 'electron'
import { describe, expect, it } from 'vitest'
import { StubBrowserWindow } from '../../test/electronStub'
import type { BackgroundTaskUpdate } from '../shared/types'
import { recordedSlowOps, startTask, timed } from './tasks'

function taskUpdates(stub: StubBrowserWindow): BackgroundTaskUpdate[] {
  return stub.webContents.sent
    .filter((m) => m.channel === 'task:update')
    .map((m) => m.args[0] as BackgroundTaskUpdate)
}

describe('background tasks (spec 10)', () => {
  it('reports started → progress → finished to the owning window', () => {
    const stub = new StubBrowserWindow()
    const task = startTask(stub as unknown as BrowserWindow, 'Indexing')
    task.progress('500/1000 files', 50)
    task.finish()

    const updates = taskUpdates(stub)
    expect(updates.map((u) => u.status)).toEqual(['started', 'progress', 'finished'])
    expect(updates[1]).toMatchObject({
      name: 'Indexing',
      message: '500/1000 files',
      percentage: 50
    })
    // one task = one stable id across updates
    expect(new Set(updates.map((u) => u.id)).size).toBe(1)
  })

  it('broadcasts to every window when no owner is given', () => {
    const a = new StubBrowserWindow()
    const b = new StubBrowserWindow()
    const closed = new StubBrowserWindow()
    closed.close()

    startTask(null, 'Global job').finish()
    expect(taskUpdates(a).map((u) => u.status)).toEqual(['started', 'finished'])
    expect(taskUpdates(b).map((u) => u.status)).toEqual(['started', 'finished'])
    expect(taskUpdates(closed)).toEqual([])
  })

  it('timed() records operations over the threshold, most recent first', async () => {
    const before = recordedSlowOps().length

    const fast = await timed('fast-op', 60_000, async () => 'quick')
    expect(fast).toBe('quick')
    expect(recordedSlowOps().length).toBe(before)

    await timed('slow-op-one', 1, () => new Promise((r) => setTimeout(() => r(null), 20)))
    await timed('slow-op-two', 1, () => new Promise((r) => setTimeout(() => r(null), 20)))
    const ops = recordedSlowOps()
    expect(ops.length).toBe(before + 2)
    expect(ops[0].operation).toBe('slow-op-two')
    expect(ops[1].operation).toBe('slow-op-one')
    expect(ops[0].ms).toBeGreaterThanOrEqual(15)
  })

  it('timed() records even when the operation throws', async () => {
    await expect(
      timed('slow-failure', 1, async () => {
        await new Promise((r) => setTimeout(r, 20))
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(recordedSlowOps()[0].operation).toBe('slow-failure')
  })
})
