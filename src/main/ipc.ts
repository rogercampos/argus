import { join } from 'node:path'
import { BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron'
import { formatDiffTarget } from '../shared/diffTarget'
import type { KeymapConfig } from '../shared/shortcuts'
import type { DiffSource, PersistedWorkspaceState, SearchOptions } from '../shared/types'
import {
  type DiffSession,
  disposeDiffSession,
  loadDiff,
  openPullRequests,
  readDiffSide,
  recentCommits,
  repoRoot
} from './diff'
import { startGitMonitor } from './git'
import { lspManagerFor } from './lsp/manager'
import { rebuildApplicationMenu } from './menu'
import {
  fileExists,
  gitStatus,
  listFiles,
  listIgnoredEntries,
  listTopLevel,
  readFile,
  readFileAbsolute,
  writeFile,
  writeFileAbsolute
} from './repo'
import { type RunningSearch, replaceAll, runSearch } from './search'
import {
  listRecentWorkspaces,
  loadFileViewState,
  loadKeymap,
  loadWorkspaceState,
  removeRecentWorkspace,
  saveFileViewState,
  saveKeymap,
  saveWorkspaceState
} from './state'
import { recordedSlowOps, startTask, timed } from './tasks'
import { startWatching } from './watcher'
import {
  openDiffWindow,
  openWorkspaceWindow,
  repoForDiffWindow,
  workspaceForWindow
} from './windows'

// one active search per (window, searchId)
const activeSearches = new Map<string, RunningSearch>()

// diff windows: the loaded comparison, and a counter so a slow load that
// finishes after a newer one can't overwrite it
const diffSessions = new Map<number, DiffSession>()
const diffLoadSeq = new Map<number, number>()

type DiffLoadOutcome = Awaited<ReturnType<typeof loadDiff>> | { error: string }

function runDiffLoad(repo: string, source: DiffSource): Promise<DiffLoadOutcome> {
  return loadDiff(repo, source).catch((error: unknown) => ({
    error: error instanceof Error ? error.message : String(error)
  }))
}

/**
 * A new diff window's first comparison starts loading in main the moment the
 * window is created, while the renderer is still booting; the renderer's
 * first diff:load for that same target then just picks up the result.
 */
const diffPrefetch = new Map<number, { target: string; outcome: Promise<DiffLoadOutcome> }>()

/** Open a diff window for the repo containing `dir`; false if it isn't in one. */
export async function openDiffForDirectory(
  dir: string,
  source: DiffSource = { kind: 'uncommitted' }
): Promise<boolean> {
  const root = await repoRoot(dir)
  if (!root) {
    await dialog.showMessageBox({
      type: 'warning',
      message: 'Not a git repository',
      detail: `${dir} isn't inside a git repository, so there's no diff to review.`
    })
    return false
  }
  const window = openDiffWindow(root, source)
  const windowId = window.id
  diffPrefetch.set(windowId, {
    target: formatDiffTarget(source),
    outcome: runDiffLoad(root, source)
  })
  window.once('closed', () => {
    const session = diffSessions.get(windowId)
    if (session) disposeDiffSession(session)
    diffSessions.delete(windowId)
    diffLoadSeq.delete(windowId)
    const pending = diffPrefetch.get(windowId)
    diffPrefetch.delete(windowId)
    void pending?.outcome.then((o) => 'session' in o && disposeDiffSession(o.session))
  })
  return true
}

export async function showOpenDiffDialog(): Promise<void> {
  const result = await dialog.showOpenDialog({
    title: 'Review Diff',
    buttonLabel: 'Review',
    properties: ['openDirectory']
  })
  if (!result.canceled && result.filePaths[0]) await openDiffForDirectory(result.filePaths[0])
}

export async function showOpenFolderDialog(): Promise<void> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (!result.canceled && result.filePaths[0]) {
    openWorkspaceWindow(result.filePaths[0])
    void rebuildApplicationMenu()
  }
}

/** The repository owning this IPC event's diff window; throws for other windows. */
function eventDiffRepo(event: Electron.IpcMainInvokeEvent): { windowId: number; repo: string } {
  const window = BrowserWindow.fromWebContents(event.sender)
  const repo = window ? repoForDiffWindow(window.id) : null
  if (!window || !repo) throw new Error('Not a diff window')
  return { windowId: window.id, repo }
}

/** The workspace path owning this IPC event's window; throws for welcome windows. */
function eventWorkspace(event: Electron.IpcMainInvokeEvent): string {
  const window = BrowserWindow.fromWebContents(event.sender)
  const workspace = window ? workspaceForWindow(window.id) : null
  if (!workspace) throw new Error('No workspace for this window')
  return workspace
}

export function registerIpcHandlers(): void {
  // app / windows
  ipcMain.handle('app:open-folder-dialog', () => showOpenFolderDialog())
  ipcMain.handle('app:open-workspace', (_event, path: string) => {
    openWorkspaceWindow(path)
    void rebuildApplicationMenu()
  })
  ipcMain.handle('app:recent-workspaces', (_event, limit: number) => listRecentWorkspaces(limit))
  ipcMain.handle('app:slow-ops', () => recordedSlowOps())

  // keyboard shortcuts (global). Saving rebuilds the native menu so its
  // accelerators reflect the change immediately.
  ipcMain.handle('keymap:load', () => loadKeymap())
  ipcMain.handle('keymap:save', async (_event, config: KeymapConfig) => {
    await saveKeymap(config)
    await rebuildApplicationMenu()
  })
  // While recording a shortcut, drop the menu so its accelerators don't
  // intercept the keys being captured (e.g. Cmd+S would otherwise Save).
  ipcMain.handle('menu:suspend', () => Menu.setApplicationMenu(null))
  ipcMain.handle('menu:resume', () => rebuildApplicationMenu())
  ipcMain.handle('app:remove-recent-workspace', async (_event, path: string) => {
    await removeRecentWorkspace(path)
    void rebuildApplicationMenu() // Open Recent submenu reflects the removal
  })

  // workspace state
  ipcMain.handle('workspace:load-state', (event) => loadWorkspaceState(eventWorkspace(event)))
  ipcMain.handle('workspace:save-state', (event, state: PersistedWorkspaceState) =>
    saveWorkspaceState(eventWorkspace(event), state)
  )
  ipcMain.handle('workspace:load-file-state', (event, relPath: string) =>
    loadFileViewState(eventWorkspace(event), relPath)
  )
  ipcMain.handle(
    'workspace:save-file-state',
    (event, relPath: string, state: { cursorOffset: number; scrollTop: number }) =>
      saveFileViewState(eventWorkspace(event), relPath, state)
  )

  // diff review windows (the repo is the window's own, never renderer-supplied)
  ipcMain.handle('diff:open-dialog', () => showOpenDiffDialog())
  ipcMain.handle('diff:open-window', async (_event, dir: string, source?: DiffSource) => {
    await openDiffForDirectory(dir, source)
  })
  ipcMain.handle('diff:load', async (event, source: DiffSource) => {
    const { windowId, repo } = eventDiffRepo(event)
    const seq = (diffLoadSeq.get(windowId) ?? 0) + 1
    diffLoadSeq.set(windowId, seq)

    const prefetched = diffPrefetch.get(windowId)
    diffPrefetch.delete(windowId)
    const outcome =
      prefetched?.target === formatDiffTarget(source)
        ? await prefetched.outcome
        : await runDiffLoad(repo, source)
    if (prefetched && prefetched.target !== formatDiffTarget(source)) {
      void prefetched.outcome.then((o) => 'session' in o && disposeDiffSession(o.session))
    }

    if ('error' in outcome) return { ok: false, error: outcome.error }
    if (diffLoadSeq.get(windowId) === seq) {
      const previous = diffSessions.get(windowId)
      if (previous) disposeDiffSession(previous)
      diffSessions.set(windowId, outcome.session)
    } else {
      disposeDiffSession(outcome.session) // superseded by a newer load
    }
    return { ok: true, summary: outcome.summary }
  })
  ipcMain.handle('diff:read-file', (event, side: 'old' | 'new', path: string) => {
    const { windowId } = eventDiffRepo(event)
    const session = diffSessions.get(windowId)
    if (!session) return { kind: 'error', message: 'No diff loaded' }
    return readDiffSide(session, side, path)
  })
  ipcMain.handle('diff:recent-commits', (event, limit: number) =>
    recentCommits(eventDiffRepo(event).repo, limit)
  )
  ipcMain.handle('diff:open-prs', (event) => openPullRequests(eventDiffRepo(event).repo))
  ipcMain.handle('shell:open-external', async (_event, url: string) => {
    // only web links (PR pages); never file:// or custom schemes
    if (/^https?:\/\//.test(url)) await shell.openExternal(url)
  })

  // file watching + git monitoring (scoped to the window's workspace)
  ipcMain.handle('watch:start', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    const root = eventWorkspace(event)
    await startGitMonitor(window, root)
    await startWatching(window, root)
  })

  // repo — the root is the window's own workspace, never a renderer-supplied
  // path, so a window can only ever read/list inside the folder it owns
  ipcMain.handle('repo:list-files', (event) => listFiles(eventWorkspace(event)))
  ipcMain.handle('repo:list-ignored', (event) => listIgnoredEntries(eventWorkspace(event)))
  ipcMain.handle('repo:list-top-level', (event) => listTopLevel(eventWorkspace(event)))
  ipcMain.handle('repo:git-status', (event) => gitStatus(eventWorkspace(event)))
  ipcMain.handle('file:read', (event, _root: string, relPath: string) =>
    readFile(eventWorkspace(event), relPath)
  )
  ipcMain.handle('file:write', async (event, _root: string, relPath: string, content: string) => {
    const root = eventWorkspace(event)
    const result = await writeFile(root, relPath, content)
    // saved files re-scan in semgrep (spec 12)
    if (result.ok) {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (window) lspManagerFor(window, root)?.noteFileSaved(relPath)
    }
    return result
  })
  // global search (spec 03)
  ipcMain.handle('search:start', (event, searchId: number, options: SearchOptions) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    const key = `${window.id}:${searchId}`
    activeSearches.get(key)?.cancel()
    const search = runSearch(eventWorkspace(event), options, (progress) => {
      if (!window.isDestroyed()) {
        window.webContents.send('search:progress', searchId, progress)
      }
      if (progress.done) activeSearches.delete(key)
    })
    activeSearches.set(key, search)
  })
  ipcMain.handle('search:cancel', (event, searchId: number) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    const key = `${window.id}:${searchId}`
    activeSearches.get(key)?.cancel()
    activeSearches.delete(key)
  })
  ipcMain.handle(
    'search:replace-all',
    async (event, options: SearchOptions, replacement: string) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const task = startTask(window, `Replacing "${options.pattern}"`)
      try {
        return await timed('replace-all', 10_000, () =>
          replaceAll(eventWorkspace(event), options, replacement, (done, total, replaced) => {
            task.progress(
              `${done}/${total} files (${replaced} replaced)`,
              Math.round((done / Math.max(1, total)) * 100)
            )
          })
        )
      } finally {
        task.finish()
      }
    }
  )

  // LSP (spec 08)
  const lsp = (event: Electron.IpcMainInvokeEvent): ReturnType<typeof lspManagerFor> | null => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return null
    return lspManagerFor(window, eventWorkspace(event))
  }
  ipcMain.handle('lsp:did-open', (event, relPath: string, text: string) =>
    lsp(event)?.didOpen(relPath, text)
  )
  ipcMain.handle('lsp:did-change', (event, relPath: string, text: string) =>
    lsp(event)?.didChange(relPath, text)
  )
  ipcMain.handle('lsp:did-close', (event, relPath: string) => lsp(event)?.didClose(relPath))
  ipcMain.handle('lsp:hover', (event, relPath: string, line: number, character: number) =>
    lsp(event)?.hover(relPath, line, character)
  )
  ipcMain.handle(
    'lsp:definition',
    (
      event,
      relPath: string,
      line: number,
      character: number,
      kind: 'definition' | 'typeDefinition'
    ) => lsp(event)?.definition(relPath, line, character, kind)
  )
  ipcMain.handle('lsp:completion', (event, relPath: string, line: number, character: number) =>
    lsp(event)?.completion(relPath, line, character)
  )
  ipcMain.handle('lsp:workspace-symbols', (event, query: string) =>
    lsp(event)?.workspaceSymbols(query)
  )
  ipcMain.handle('rails:schema-for', (event, relPath: string) => lsp(event)?.railsSchema(relPath))

  ipcMain.handle('shell:reveal', (event, relPath: string) => {
    shell.showItemInFolder(join(eventWorkspace(event), relPath))
  })
  ipcMain.handle('clipboard:write', (_event, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.handle('file:exists', (_event, absPath: string) => fileExists(absPath))
  ipcMain.handle('file:read-abs', (_event, absPath: string) => readFileAbsolute(absPath))
  ipcMain.handle('file:write-abs', (_event, absPath: string, content: string) =>
    writeFileAbsolute(absPath, content)
  )
}
