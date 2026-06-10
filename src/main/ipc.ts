import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { PersistedWorkspaceState } from '../shared/types'
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
import {
  listRecentWorkspaces,
  loadFileViewState,
  loadWorkspaceState,
  saveFileViewState,
  saveWorkspaceState
} from './state'
import { startWatching } from './watcher'
import { openWorkspaceWindow, workspaceForWindow } from './windows'

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

  // file watching (scoped to the window's workspace)
  ipcMain.handle('watch:start', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) return startWatching(window, eventWorkspace(event))
    return undefined
  })

  // repo
  ipcMain.handle('repo:list-files', (_event, root: string) => listFiles(root))
  ipcMain.handle('repo:git-status', (_event, root: string) => gitStatus(root))
  ipcMain.handle('file:read', (_event, root: string, relPath: string) => readFile(root, relPath))
  ipcMain.handle('file:write', (_event, root: string, relPath: string, content: string) =>
    writeFile(root, relPath, content)
  )
  ipcMain.handle('file:exists', (_event, absPath: string) => fileExists(absPath))
  ipcMain.handle('file:read-abs', (_event, absPath: string) => readFileAbsolute(absPath))
  ipcMain.handle('file:write-abs', (_event, absPath: string, content: string) =>
    writeFileAbsolute(absPath, content)
  )
}
