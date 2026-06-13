import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { defaultKeymapConfig, type KeymapConfig } from '../shared/shortcuts'
import type { AppState, PersistedWorkspaceState, RecentWorkspaceEntry } from '../shared/types'

/**
 * JSON persistence under the Electron userData dir (spec 15).
 * All writes are atomic (temp file + rename). No backward compatibility:
 * unreadable files are discarded.
 */

let baseDir = ''

export function initStateDir(userDataPath: string): void {
  baseDir = join(userDataPath, 'state')
}

function stateDir(): string {
  if (!baseDir) throw new Error('state dir not initialized')
  return baseDir
}

export function workspaceHash(workspacePath: string): string {
  return createHash('sha256').update(workspacePath).digest('hex').slice(0, 32)
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

let tmpCounter = 0

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  // a counter, not a timestamp: concurrent writes in the same millisecond
  // must not collide on the temp name (the second rename would throw)
  const tmp = `${path}.tmp-${process.pid}-${++tmpCounter}`
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await fs.rename(tmp, path)
}

// --- App state (window list for session restore) ---

export async function loadAppState(): Promise<AppState | null> {
  return readJson<AppState>(join(stateDir(), 'app.json'))
}

export async function saveAppState(state: AppState): Promise<void> {
  await writeJsonAtomic(join(stateDir(), 'app.json'), state)
}

// --- Keyboard shortcuts (global, not per-workspace) ---

export async function loadKeymap(): Promise<KeymapConfig> {
  const stored = await readJson<KeymapConfig>(join(stateDir(), 'keymap.json'))
  return stored?.template
    ? { template: stored.template, overrides: stored.overrides ?? {} }
    : defaultKeymapConfig()
}

export async function saveKeymap(config: KeymapConfig): Promise<void> {
  await writeJsonAtomic(join(stateDir(), 'keymap.json'), config)
}

// --- Recent workspaces ---

const MAX_RECENT_WORKSPACES = 50

export async function loadRecentWorkspaces(): Promise<RecentWorkspaceEntry[]> {
  const list = await readJson<RecentWorkspaceEntry[]>(join(stateDir(), 'recent-workspaces.json'))
  return Array.isArray(list) ? list : []
}

export async function touchRecentWorkspace(workspacePath: string): Promise<void> {
  const list = await loadRecentWorkspaces()
  const filtered = list.filter((e) => e.path !== workspacePath)
  filtered.unshift({ path: workspacePath, lastOpen: Date.now() })
  await writeJsonAtomic(
    join(stateDir(), 'recent-workspaces.json'),
    filtered.slice(0, MAX_RECENT_WORKSPACES)
  )
}

/** Remove a workspace from the remembered list (welcome window delete). */
export async function removeRecentWorkspace(workspacePath: string): Promise<void> {
  const list = await loadRecentWorkspaces()
  await writeJsonAtomic(
    join(stateDir(), 'recent-workspaces.json'),
    list.filter((e) => e.path !== workspacePath)
  )
}

/** Recent workspaces whose folder still exists, most recent first. */
export async function listRecentWorkspaces(limit: number): Promise<RecentWorkspaceEntry[]> {
  const list = await loadRecentWorkspaces()
  const existing: RecentWorkspaceEntry[] = []
  for (const entry of list) {
    if (existing.length >= limit) break
    try {
      const stat = await fs.stat(entry.path)
      if (stat.isDirectory()) existing.push(entry)
    } catch {
      // dropped lazily
    }
  }
  return existing
}

// --- Per-workspace state ---

function workspaceFile(workspacePath: string): string {
  return join(stateDir(), 'workspaces', workspaceHash(workspacePath), 'workspace.json')
}

export async function loadWorkspaceState(
  workspacePath: string
): Promise<PersistedWorkspaceState | null> {
  return readJson<PersistedWorkspaceState>(workspaceFile(workspacePath))
}

export async function saveWorkspaceState(
  workspacePath: string,
  state: PersistedWorkspaceState
): Promise<void> {
  await writeJsonAtomic(workspaceFile(workspacePath), state)
}

// --- Per-file editor state (cursor/scroll) ---

interface FileViewState {
  cursorOffset: number
  scrollTop: number
}

/** Cap on per-file view-state files kept per workspace; the hash is one-way so
 * orphans from deleted/renamed files can't be matched back — bound them by count. */
const MAX_FILE_VIEW_STATES = 500

function fileStateDir(workspacePath: string): string {
  return join(stateDir(), 'workspaces', workspaceHash(workspacePath), 'files')
}

function fileStateFile(workspacePath: string, relPath: string): string {
  const fileHash = createHash('sha256').update(relPath).digest('hex').slice(0, 32)
  return join(fileStateDir(workspacePath), `${fileHash}.json`)
}

/** Drop the oldest per-file view-state files beyond `cap` (by mtime), so they
 * don't accumulate forever as files are deleted/renamed across sessions. */
export async function pruneFileViewStates(
  workspacePath: string,
  cap = MAX_FILE_VIEW_STATES
): Promise<void> {
  const dir = fileStateDir(workspacePath)
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return // no per-file states yet
  }
  if (names.length <= cap) return
  const stats = await Promise.all(
    names.map(async (name) => {
      try {
        return { name, mtimeMs: (await fs.stat(join(dir, name))).mtimeMs }
      } catch {
        return { name, mtimeMs: 0 }
      }
    })
  )
  stats.sort((a, b) => b.mtimeMs - a.mtimeMs) // newest first
  await Promise.all(stats.slice(cap).map((s) => fs.rm(join(dir, s.name)).catch(() => {})))
}

export async function loadFileViewState(
  workspacePath: string,
  relPath: string
): Promise<FileViewState | null> {
  return readJson<FileViewState>(fileStateFile(workspacePath, relPath))
}

export async function saveFileViewState(
  workspacePath: string,
  relPath: string,
  state: FileViewState
): Promise<void> {
  await writeJsonAtomic(fileStateFile(workspacePath, relPath), state)
  await pruneFileViewStates(workspacePath)
}
