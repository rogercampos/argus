import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
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

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
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

function fileStateFile(workspacePath: string, relPath: string): string {
  const fileHash = createHash('sha256').update(relPath).digest('hex').slice(0, 32)
  return join(stateDir(), 'workspaces', workspaceHash(workspacePath), 'files', `${fileHash}.json`)
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
}
