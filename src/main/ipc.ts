import { join } from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { PersistedWorkspaceState, SearchOptions } from '../shared/types'
import { startGitMonitor } from './git'
import { lspManagerFor } from './lsp/manager'
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
import { recordedSlowOps, startTask, timed } from './tasks'
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
  ipcMain.handle('app:slow-ops', () => recordedSlowOps())

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
  ipcMain.handle('file:write', async (event, root: string, relPath: string, content: string) => {
    const result = await writeFile(root, relPath, content)
    // saved files re-scan in semgrep (spec 12)
    if (result.ok) {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (window) lspManagerFor(window, root).noteFileSaved(relPath)
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

  ipcMain.handle('file:exists', (_event, absPath: string) => fileExists(absPath))
  ipcMain.handle('file:read-abs', (_event, absPath: string) => readFileAbsolute(absPath))
  ipcMain.handle('file:write-abs', (_event, absPath: string, content: string) =>
    writeFileAbsolute(absPath, content)
  )
}
