import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { PersistedWorkspaceState, SearchOptions } from '../shared/types'
import { startGitMonitor } from './git'
import { rebuildApplicationMenu } from './menu'
import {
  fileExists,
  gitStatus,
  listFiles,
  readFile,
  readFileAbsolute,
  writeFile,
  writeFileAbsolute
} from './repo'
import { type RunningSearch, replaceAll, runSearch } from './search'
import {
  listRecentWorkspaces,
  loadFileViewState,
  loadWorkspaceState,
  saveFileViewState,
  saveWorkspaceState
} from './state'
import { startTask, timed } from './tasks'
import { startWatching } from './watcher'
import { openWorkspaceWindow, workspaceForWindow } from './windows'

// one active search per (window, searchId)
const activeSearches = new Map<string, RunningSearch>()

export async function showOpenFolderDialog(): Promise<void> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (!result.canceled && result.filePaths[0]) {
    openWorkspaceWindow(result.filePaths[0])
    void rebuildApplicationMenu()
  }
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

  // file watching + git monitoring (scoped to the window's workspace)
  ipcMain.handle('watch:start', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    const root = eventWorkspace(event)
    await startGitMonitor(window, root)
    await startWatching(window, root)
  })

  // repo
  ipcMain.handle('repo:list-files', (_event, root: string) => listFiles(root))
  ipcMain.handle('repo:git-status', (_event, root: string) => gitStatus(root))
  ipcMain.handle('file:read', (_event, root: string, relPath: string) => readFile(root, relPath))
  ipcMain.handle('file:write', (_event, root: string, relPath: string, content: string) =>
    writeFile(root, relPath, content)
  )
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

  ipcMain.handle('file:exists', (_event, absPath: string) => fileExists(absPath))
  ipcMain.handle('file:read-abs', (_event, absPath: string) => readFileAbsolute(absPath))
  ipcMain.handle('file:write-abs', (_event, absPath: string, content: string) =>
    writeFileAbsolute(absPath, content)
  )
}
