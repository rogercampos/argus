import {
  type ChildProcess,
  type ExecFileOptions,
  execFile,
  type SpawnOptions,
  spawn
} from 'node:child_process'
import type { ProcActivity, ProcKind, ProcStatEntry } from '../shared/types'

/**
 * Central registry of every external process Argus spawns (LSP servers,
 * ripgrep, git, semgrep, shell-env resolution, installers). All spawn sites
 * go through trackedSpawn/trackedExecFile so the resource monitor knows what
 * is alive at any moment; short-lived runs are aggregated as activity.
 */

export interface TrackedMeta {
  kind: ProcKind
  label: string
  /** owning workspace window; omitted = visible in every window */
  windowId?: number
  /** the spawn site reports its own failures, so skip the central handler */
  selfReportsErrors?: boolean
}

export interface LiveProcess extends TrackedMeta {
  id: number
  pid: number
  startedAt: number
}

const ACTIVITY_WINDOW_MS = 5 * 60 * 1000
const MAX_ACTIVITY_SAMPLES = 500

const live = new Map<number, LiveProcess>()
let nextId = 1
const changeListeners = new Set<() => void>()
const activity = new Map<ProcKind, { totalCount: number; recent: { at: number; ms: number }[] }>()

export function onRegistryChange(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

/**
 * Reporter for spawn-level failures (ENOENT, EACCES, …) of any tracked
 * process. Injected from index.ts so this module stays free of an Electron
 * dependency (it is also imported by pure unit tests).
 */
type SpawnErrorListener = (meta: TrackedMeta, error: Error) => void
let spawnErrorListener: SpawnErrorListener | null = null
export function setSpawnErrorListener(listener: SpawnErrorListener): void {
  spawnErrorListener = listener
}

export function liveProcesses(): LiveProcess[] {
  return [...live.values()]
}

export function activitySummary(): ProcActivity[] {
  const cutoff = Date.now() - ACTIVITY_WINDOW_MS
  const result: ProcActivity[] = []
  for (const [kind, entry] of activity) {
    const recent = entry.recent.filter((r) => r.at >= cutoff)
    result.push({
      kind,
      totalCount: entry.totalCount,
      count5m: recent.length,
      avgMs5m:
        recent.length > 0
          ? Math.round(recent.reduce((sum, r) => sum + r.ms, 0) / recent.length)
          : null,
      lastAt: entry.recent.at(-1)?.at ?? null
    })
  }
  return result
}

function recordActivity(kind: ProcKind, ms: number): void {
  const entry = activity.get(kind) ?? { totalCount: 0, recent: [] }
  entry.totalCount += 1
  entry.recent.push({ at: Date.now(), ms })
  const cutoff = Date.now() - ACTIVITY_WINDOW_MS
  while (
    entry.recent.length > MAX_ACTIVITY_SAMPLES ||
    (entry.recent.length > 0 && entry.recent[0].at < cutoff)
  ) {
    entry.recent.shift()
  }
  activity.set(kind, entry)
}

function track(child: ChildProcess, meta: TrackedMeta): void {
  // A spawn-level failure (ENOENT, EACCES, …) fires 'error' — possibly before
  // a pid is ever assigned — so report it regardless of registration below.
  child.once('error', (error: Error) => {
    if (!meta.selfReportsErrors) spawnErrorListener?.(meta, error)
  })
  const pid = child.pid
  if (pid === undefined) return // spawn failed synchronously; only the error report applies
  const entry: LiveProcess = { ...meta, id: nextId++, pid, startedAt: Date.now() }
  live.set(entry.id, entry)
  for (const listener of changeListeners) listener()
  const done = (): void => {
    if (!live.delete(entry.id)) return
    recordActivity(meta.kind, Date.now() - entry.startedAt)
    for (const listener of changeListeners) listener()
  }
  child.once('exit', done)
  child.once('error', done)
}

export function trackedSpawn(
  cmd: string,
  args: string[],
  options: SpawnOptions,
  meta: TrackedMeta
): ChildProcess {
  const child = spawn(cmd, args, options)
  track(child, meta)
  return child
}

/** execFile as a promise; on failure stdout/stderr are attached to the error. */
export function trackedExecFile(
  cmd: string,
  args: string[],
  options: ExecFileOptions,
  meta: TrackedMeta
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { ...options, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }))
      else resolve({ stdout, stderr })
    })
    track(child, meta)
  })
}

// --- ps sampling math (pure; the sampler in procStats.ts feeds it) ---

export interface PsRow {
  pid: number
  ppid: number
  rssKb: number
  cpuSec: number
}

/** Parse `ps -axo pid=,ppid=,rss=,cputime=` output. */
export function parsePsTable(stdout: string): Map<number, PsRow> {
  const rows = new Map<number, PsRow>()
  for (const line of stdout.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 4) continue
    const pid = Number(fields[0])
    const ppid = Number(fields[1])
    const rssKb = Number(fields[2])
    if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !Number.isFinite(rssKb)) continue
    rows.set(pid, { pid, ppid, rssKb, cpuSec: parseCpuTime(fields[3]) })
  }
  return rows
}

/** ps cputime: "[dd-]hh:mm:ss.cc" or "mm:ss.cc" → seconds. */
export function parseCpuTime(value: string): number {
  let days = 0
  let rest = value
  const dash = value.indexOf('-')
  if (dash !== -1) {
    days = Number(value.slice(0, dash))
    rest = value.slice(dash + 1)
  }
  let seconds = 0
  for (const part of rest.split(':')) seconds = seconds * 60 + Number(part)
  return days * 86400 + seconds
}

/**
 * Roll up each live process with its full descendant tree (vtsls→tsserver,
 * npm install trees, shell hooks): RSS summed, CPU% from cputime deltas
 * between samples (macOS ps %cpu is a lifetime average, useless live).
 */
export function computeProcStats(
  processes: LiveProcess[],
  table: Map<number, PsRow>,
  prevCpuSec: Map<number, number>,
  elapsedSec: number
): { entries: ProcStatEntry[]; cpuSec: Map<number, number> } {
  const childrenOf = new Map<number, number[]>()
  for (const row of table.values()) {
    if (row.ppid === row.pid) continue
    const list = childrenOf.get(row.ppid) ?? []
    list.push(row.pid)
    childrenOf.set(row.ppid, list)
  }
  const nextCpuSec = new Map<number, number>()
  for (const row of table.values()) nextCpuSec.set(row.pid, row.cpuSec)

  const entries: ProcStatEntry[] = []
  for (const proc of processes) {
    if (!table.has(proc.pid)) continue // exited between registry read and ps
    const pids = [proc.pid]
    const seen = new Set(pids)
    for (let i = 0; i < pids.length; i++) {
      for (const child of childrenOf.get(pids[i]) ?? []) {
        if (!seen.has(child)) {
          seen.add(child)
          pids.push(child)
        }
      }
    }
    let memBytes = 0
    let cpu = 0
    for (const pid of pids) {
      const row = table.get(pid)
      if (!row) continue
      memBytes += row.rssKb * 1024
      const prev = prevCpuSec.get(pid)
      if (prev !== undefined && elapsedSec > 0) {
        cpu += (Math.max(0, row.cpuSec - prev) / elapsedSec) * 100
      }
    }
    entries.push({
      id: proc.id,
      pid: proc.pid,
      kind: proc.kind,
      label: proc.label,
      windowId: proc.windowId,
      startedAt: proc.startedAt,
      cpu,
      memBytes,
      childCount: pids.length - 1
    })
  }
  return { entries, cpuSec: nextCpuSec }
}
