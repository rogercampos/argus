import { describe, expect, it } from 'vitest'
import {
  activitySummary,
  computeProcStats,
  type LiveProcess,
  liveProcesses,
  parseCpuTime,
  parsePsTable,
  trackedExecFile,
  trackedSpawn
} from './procRegistry'

describe('parseCpuTime', () => {
  it('parses mm:ss.cc', () => {
    expect(parseCpuTime('0:00.04')).toBeCloseTo(0.04)
    expect(parseCpuTime('2:30.50')).toBeCloseTo(150.5)
  })

  it('parses hh:mm:ss', () => {
    expect(parseCpuTime('1:02:03')).toBe(3723)
  })

  it('parses dd-hh:mm:ss', () => {
    expect(parseCpuTime('2-03:04:05')).toBe(2 * 86400 + 3 * 3600 + 4 * 60 + 5)
  })
})

describe('parsePsTable', () => {
  it('parses pid/ppid/rss/cputime rows and skips malformed lines', () => {
    const table = parsePsTable('  100  1  2048  0:01.00\n  200  100  512  0:00.50\n\ngarbage\n')
    expect(table.size).toBe(2)
    expect(table.get(100)).toEqual({ pid: 100, ppid: 1, rssKb: 2048, cpuSec: 1 })
    expect(table.get(200)).toEqual({ pid: 200, ppid: 100, rssKb: 512, cpuSec: 0.5 })
  })
})

describe('computeProcStats', () => {
  const proc: LiveProcess = {
    id: 1,
    pid: 100,
    kind: 'lsp',
    label: 'vtsls (repo)',
    startedAt: 0
  }

  it('rolls up memory and child count across the descendant tree', () => {
    // 100 → 200 → 300, plus unrelated 400
    const table = parsePsTable(
      '100 1 1000 0:01.00\n200 100 2000 0:02.00\n300 200 4000 0:04.00\n400 1 8000 0:08.00'
    )
    const { entries } = computeProcStats([proc], table, new Map(), 0)
    expect(entries).toHaveLength(1)
    expect(entries[0].memBytes).toBe((1000 + 2000 + 4000) * 1024)
    expect(entries[0].childCount).toBe(2)
    expect(entries[0].cpu).toBe(0) // no previous sample yet
  })

  it('computes CPU% from cputime deltas over elapsed time', () => {
    const table = parsePsTable('100 1 1000 0:02.00\n200 100 1000 0:03.00')
    const prev = new Map([
      [100, 1],
      [200, 2]
    ])
    // each pid used 1 cpu-second over 2 wall-seconds → 50% each → 100% rolled up
    const { entries, cpuSec } = computeProcStats([proc], table, prev, 2)
    expect(entries[0].cpu).toBeCloseTo(100)
    expect(cpuSec.get(100)).toBe(2)
    expect(cpuSec.get(200)).toBe(3)
  })

  it('drops processes that already exited and survives ppid self-loops', () => {
    const table = parsePsTable('1 1 100 0:00.10')
    const { entries } = computeProcStats([proc], table, new Map(), 1)
    expect(entries).toHaveLength(0)
  })
})

describe('tracked process registry', () => {
  it('registers a spawned process while alive and records activity after exit', async () => {
    const child = trackedSpawn('sleep', ['0.3'], {}, { kind: 'install', label: 'test sleep' })
    expect(liveProcesses().some((p) => p.pid === child.pid && p.label === 'test sleep')).toBe(true)
    await new Promise<void>((resolve) => child.once('exit', () => resolve()))
    expect(liveProcesses().some((p) => p.pid === child.pid)).toBe(false)
    const installs = activitySummary().find((a) => a.kind === 'install')
    expect(installs).toBeDefined()
    expect(installs?.totalCount).toBeGreaterThanOrEqual(1)
    expect(installs?.count5m).toBeGreaterThanOrEqual(1)
  })

  it('trackedExecFile resolves stdout and unregisters', async () => {
    const { stdout } = await trackedExecFile('echo', ['hello'], {}, { kind: 'git', label: 'echo' })
    expect(stdout.trim()).toBe('hello')
    expect(liveProcesses().some((p) => p.label === 'echo')).toBe(false)
  })

  it('trackedExecFile attaches stdout to the error on non-zero exit', async () => {
    await expect(
      trackedExecFile(
        'sh',
        ['-c', 'echo findings; exit 1'],
        {},
        { kind: 'semgrep', label: 'failing' }
      )
    ).rejects.toMatchObject({ stdout: 'findings\n' })
  })
})
