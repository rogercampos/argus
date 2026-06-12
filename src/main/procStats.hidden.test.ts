import { describe, expect, it } from 'vitest'
import { StubBrowserWindow } from '../../test/electronStub'
import { trackedSpawn } from './procRegistry'
import { startProcStats } from './procStats'

describe('process sampling with no visible windows', () => {
  it('skips sampling entirely (no proc:stats pushed)', async () => {
    const hidden = new StubBrowserWindow() // never shown
    startProcStats()
    const child = trackedSpawn('sleep', ['2'], {}, { kind: 'git', label: 'hidden test' })
    try {
      await new Promise((resolve) => setTimeout(resolve, 600))
      expect(hidden.webContents.sent.filter((m) => m.channel === 'proc:stats')).toEqual([])
    } finally {
      child.kill()
    }
  })
})
