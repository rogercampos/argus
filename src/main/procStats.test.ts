import { describe, expect, it, vi } from 'vitest'
import { StubBrowserWindow } from '../../test/electronStub'
import type { ProcStatsSnapshot } from '../shared/types'
import { trackedSpawn } from './procRegistry'
import { startProcStats } from './procStats'

describe('process resource sampling', () => {
  it('pushes snapshots with rolled-up stats to visible windows', async () => {
    const stub = new StubBrowserWindow()
    stub.show()
    startProcStats()

    // a registry change (spawn) triggers an early sample ~200ms later
    const child = trackedSpawn('sleep', ['5'], {}, { kind: 'shell-env', label: 'test sleep' })
    try {
      const snapshot = await vi.waitFor(
        () => {
          const sent = stub.webContents.sent.find((m) => m.channel === 'proc:stats')
          expect(sent).toBeDefined()
          return sent?.args[0] as ProcStatsSnapshot
        },
        { timeout: 10_000 }
      )

      expect(snapshot.entries.map((e) => e.label)).toContain('test sleep')
      const entry = snapshot.entries.find((e) => e.label === 'test sleep')
      expect(entry?.kind).toBe('shell-env')
      expect(entry?.pid).toBe(child.pid)
      expect(snapshot.totals.count).toBeGreaterThanOrEqual(1)
      // electron's own processes come from app.getAppMetrics (stubbed: main)
      expect(snapshot.app.map((a) => a.type)).toContain('main')
    } finally {
      child.kill()
    }
  })
})
