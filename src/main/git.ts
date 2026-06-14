import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { GitState, GitStatusEntry } from '../shared/types'
import { reportCrash } from './crashReporter'
import { trackedExecFile } from './procRegistry'

const MAX_BUFFER = 512 * 1024 * 1024

/**
 * Git monitoring (spec 09): branch/state from cheap .git file reads, file
 * statuses from `git status --porcelain -z`, incrementally refreshed with a
 * 500ms debounce. Pushes diffs, never full maps after the first scan.
 */

const GIT_STATUS_BY_CODE: Record<string, GitStatusEntry['status']> = {
  '?': 'untracked',
  '!': 'ignored',
  A: 'added',
  M: 'modified',
  T: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'added'
}

export function parsePorcelain(stdout: string): Map<string, GitStatusEntry['status']> {
  const map = new Map<string, GitStatusEntry['status']>()
  const tokens = stdout.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.length < 4) continue
    const x = token[0]
    const y = token[1]
    const path = token.slice(3)
    if (x === 'R' || x === 'C') i++
    const status = GIT_STATUS_BY_CODE[x === ' ' || x === '?' || x === '!' ? y : x]
    if (status) map.set(path, status)
  }
  return map
}

export async function readBranchAndState(root: string): Promise<Omit<GitState, 'isRepo'>> {
  const gitDir = join(root, '.git')
  let branch: string | null = null
  try {
    const head = (await fs.readFile(join(gitDir, 'HEAD'), 'utf8')).trim()
    branch = head.startsWith('ref: refs/heads/')
      ? head.slice('ref: refs/heads/'.length)
      : head.slice(0, 8)
  } catch {
    return { branch: null, state: null }
  }

  const checks: Array<[string, GitState['state']]> = [
    ['rebase-merge', 'rebasing'],
    ['rebase-apply', 'rebasing'],
    ['MERGE_HEAD', 'merging'],
    ['CHERRY_PICK_HEAD', 'cherry-picking'],
    ['REVERT_HEAD', 'reverting']
  ]
  for (const [file, state] of checks) {
    try {
      await fs.access(join(gitDir, file))
      return { branch, state }
    } catch {
      // not in this state
    }
  }
  return { branch, state: null }
}

/** Above this many pending paths a full rescan is cheaper than a pathspec scan. */
const MAX_TARGETED_PATHS = 500

/** Coalesce bursts of watcher events before scanning... */
const DEBOUNCE_MS = 500
/** ...but never wait longer than this, so a continuous event stream (a build,
 * a big checkout) can't keep resetting the timer and starve the flush. */
const MAX_DEBOUNCE_WAIT_MS = 2000

/** How long to wait before flushing, given when the first pending change landed. */
export function debounceWait(firstPendingAt: number, now: number): number {
  return Math.min(DEBOUNCE_MS, Math.max(0, MAX_DEBOUNCE_WAIT_MS - (now - firstPendingAt)))
}

export class GitMonitor {
  private windowId: number
  private statuses = new Map<string, GitStatusEntry['status']>()
  private lastState: Omit<GitState, 'isRepo'> = { branch: null, state: null }
  private pendingPaths = new Set<string>()
  private fullRescanPending = false
  private timer: ReturnType<typeof setTimeout> | null = null
  /** when the oldest un-flushed change arrived, for the max-wait cap */
  private firstPendingAt: number | null = null
  private isRepo = false
  private disposed = false
  private scanning = false
  /** last reported failure signature, so a persistent failure reports once per streak */
  private lastErrorSig: string | null = null

  constructor(
    private root: string,
    private window: BrowserWindow
  ) {
    this.windowId = window.id
  }

  async start(): Promise<void> {
    try {
      await fs.access(join(this.root, '.git'))
      this.isRepo = true
    } catch {
      this.isRepo = false
      this.send('git:state', { isRepo: false, branch: null, state: null })
      return
    }
    await this.refreshBranch()
    // initial full scan deferred so the tree renders first (spec 09)
    setTimeout(() => {
      this.fullRescanPending = true
      void this.flush()
    }, 300)
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
  }

  private send(channel: string, payload: unknown): void {
    if (!this.disposed && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload)
    }
  }

  /** Feed watcher events (relative paths, including .git internals). */
  noteChanges(relPaths: string[]): void {
    if (!this.isRepo) return
    for (const path of relPaths) {
      if (path === '.git' || path.startsWith('.git/')) {
        // HEAD/index/refs changes → branch refresh + full rescan
        this.fullRescanPending = true
      } else if (path.endsWith('.gitignore')) {
        this.fullRescanPending = true
      } else {
        this.pendingPaths.add(path)
      }
    }
    const now = Date.now()
    if (this.firstPendingAt === null) this.firstPendingAt = now
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(
      () => {
        this.firstPendingAt = null
        void this.flush()
      },
      debounceWait(this.firstPendingAt, now)
    )
  }

  /**
   * Single-flight: at most one git process per window. A `git status` over a
   * large repo runs for seconds; work arriving meanwhile coalesces into the
   * pending sets and is drained in one trailing scan, never in parallel.
   */
  private async flush(): Promise<void> {
    if (this.scanning) return // the running loop drains whatever accumulates
    this.scanning = true
    try {
      while (!this.disposed && (this.fullRescanPending || this.pendingPaths.size > 0)) {
        const full = this.fullRescanPending || this.pendingPaths.size > MAX_TARGETED_PATHS
        const paths = [...this.pendingPaths]
        this.fullRescanPending = false
        this.pendingPaths.clear()

        const started = Date.now()
        await this.refreshBranch()
        if (full) {
          await this.fullRescan()
        } else if (paths.length > 0) {
          await this.targetedRescan(paths)
        }

        // pace trailing scans by the cost of the last one (≤50% git duty cycle)
        if (this.fullRescanPending || this.pendingPaths.size > 0) {
          const elapsed = Date.now() - started
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(5000, Math.max(500, elapsed)))
          )
        }
      }
    } finally {
      this.scanning = false
    }
  }

  private async refreshBranch(): Promise<void> {
    const next = await readBranchAndState(this.root)
    if (next.branch !== this.lastState.branch || next.state !== this.lastState.state) {
      this.lastState = next
      this.send('git:state', { isRepo: true, ...next })
    }
  }

  private async runStatus(paths?: string[]): Promise<Map<string, GitStatusEntry['status']> | null> {
    try {
      // --no-optional-locks: status must not write .git/index, or the watcher
      // sees the write and triggers another rescan — a feedback loop
      const args = [
        '--no-optional-locks',
        '-C',
        this.root,
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all'
      ]
      if (paths && paths.length > 0) args.push('--', ...paths)
      const { stdout } = await trackedExecFile(
        'git',
        args,
        { maxBuffer: MAX_BUFFER },
        { kind: 'git', label: 'git status', windowId: this.windowId, selfReportsErrors: true }
      )
      this.lastErrorSig = null // a success ends any failure streak
      return parsePorcelain(stdout)
    } catch (error) {
      this.reportFailure('git status', error)
      return null
    }
  }

  /**
   * Surface a git failure as a crash card, once per streak: a repo with (say)
   * dubious ownership fails on every rescan, but the user only needs telling
   * once until the error changes or a scan succeeds.
   */
  private reportFailure(command: string, error: unknown): void {
    const err = error as { message?: string; code?: number; stderr?: string; stack?: string }
    const stderr = (err.stderr ?? '').trim()
    const message = err.message ?? String(error)
    const summary = stderr.split('\n')[0] || message.split('\n')[0] || 'command failed'
    const sig = `${command}|${summary}`
    if (sig === this.lastErrorSig) return
    this.lastErrorSig = sig
    reportCrash({
      origin: 'git',
      title: 'Git command failed',
      label: command,
      summary,
      detail: stderr || err.stack || message,
      windowId: this.windowId
    })
  }

  private async fullRescan(): Promise<void> {
    const next = await this.runStatus()
    if (!next) return
    const diff: Record<string, GitStatusEntry['status'] | null> = {}
    for (const [path, status] of next) {
      if (this.statuses.get(path) !== status) diff[path] = status
    }
    for (const path of this.statuses.keys()) {
      if (!next.has(path)) diff[path] = null
    }
    this.statuses = next
    if (Object.keys(diff).length > 0) this.send('git:status-diff', diff)
  }

  private async targetedRescan(paths: string[]): Promise<void> {
    const result = await this.runStatus(paths)
    if (!result) return
    const diff: Record<string, GitStatusEntry['status'] | null> = {}
    for (const path of paths) {
      const status = result.get(path) ?? null
      const previous = this.statuses.get(path) ?? null
      if (status !== previous) {
        diff[path] = status
        if (status === null) this.statuses.delete(path)
        else this.statuses.set(path, status)
      }
    }
    if (Object.keys(diff).length > 0) this.send('git:status-diff', diff)
  }

  currentStatuses(): GitStatusEntry[] {
    return [...this.statuses.entries()].map(([path, status]) => ({ path, status }))
  }
}

const monitors = new Map<number, GitMonitor>()

export async function startGitMonitor(window: BrowserWindow, root: string): Promise<void> {
  if (monitors.has(window.id)) return
  const monitor = new GitMonitor(root, window)
  monitors.set(window.id, monitor)
  window.on('closed', () => {
    monitor.dispose()
    monitors.delete(window.id)
  })
  await monitor.start()
}

export function gitMonitorFor(windowId: number): GitMonitor | undefined {
  return monitors.get(windowId)
}
