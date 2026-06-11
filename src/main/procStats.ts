import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { app, BrowserWindow } from 'electron'
import type { AppProcStat, ProcStatsSnapshot } from '../shared/types'
import {
  activitySummary,
  computeProcStats,
  liveProcesses,
  onRegistryChange,
  type PsRow,
  parsePsTable
} from './procRegistry'

const execFileAsync = promisify(execFile)

/**
 * Resource sampler for the status-bar process monitor: every 2s, one
 * system-wide `ps` snapshot rolls up CPU/RSS for every registered process
 * tree; pushed to each workspace window over proc:stats. Registry changes
 * (spawn/exit) trigger an early sample so new processes show up immediately.
 */

const SAMPLE_INTERVAL_MS = 2000
const MIN_SAMPLE_GAP_MS = 750

let prevCpuSec = new Map<number, number>()
let lastSampleAt = 0
let sampling = false
let earlyTimer: ReturnType<typeof setTimeout> | null = null
let started = false

export function startProcStats(): void {
  if (started) return
  started = true
  setInterval(() => void sample(), SAMPLE_INTERVAL_MS)
  onRegistryChange(() => {
    if (earlyTimer || Date.now() - lastSampleAt < MIN_SAMPLE_GAP_MS) return
    earlyTimer = setTimeout(() => {
      earlyTimer = null
      void sample()
    }, 200)
  })
}

async function sample(): Promise<void> {
  if (sampling) return
  sampling = true
  try {
    const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
    if (!windows.some((w) => w.isVisible())) return

    const processes = liveProcesses()
    let table = new Map<number, PsRow>()
    if (processes.length > 0) {
      try {
        const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,rss=,cputime='], {
          maxBuffer: 16 * 1024 * 1024
        })
        table = parsePsTable(stdout)
      } catch {
        // ps unavailable: entries report zero usage this tick
      }
    }

    const now = Date.now()
    const elapsedSec = lastSampleAt > 0 ? (now - lastSampleAt) / 1000 : 0
    const { entries, cpuSec } = computeProcStats(processes, table, prevCpuSec, elapsedSec)
    prevCpuSec = cpuSec
    lastSampleAt = now

    const appStats: AppProcStat[] = app.getAppMetrics().map((m) => ({
      type: m.type === 'Browser' ? 'main' : m.type === 'Tab' ? 'renderer' : m.type.toLowerCase(),
      pid: m.pid,
      cpu: m.cpu.percentCPUUsage,
      memBytes: (m.memory?.workingSetSize ?? 0) * 1024
    }))
    const activity = activitySummary()

    for (const window of windows) {
      if (window.isDestroyed()) continue
      const visible = entries.filter((e) => e.windowId === undefined || e.windowId === window.id)
      const snapshot: ProcStatsSnapshot = {
        at: now,
        entries: visible,
        activity,
        app: appStats,
        totals: {
          cpu: visible.reduce((sum, e) => sum + e.cpu, 0),
          memBytes: visible.reduce((sum, e) => sum + e.memBytes, 0),
          count: visible.length
        }
      }
      window.webContents.send('proc:stats', snapshot)
    }
  } finally {
    sampling = false
  }
}
