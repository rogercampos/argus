import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'
import type {
  ArgusApi,
  BackgroundTaskUpdate,
  GitState,
  GitStatusDiff,
  MenuCommand,
  SearchProgress,
  WatchEvent,
  WindowInitData
} from '../shared/types'

function makeListener<T>(channel: string) {
  return (handler: (payload: T) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: T): void => handler(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

function parseWindowInit(): WindowInitData {
  const workspaceArg = process.argv.find((a) => a.startsWith('--argus-workspace='))
  if (workspaceArg) {
    return { kind: 'workspace', workspacePath: workspaceArg.slice('--argus-workspace='.length) }
  }
  return { kind: 'welcome', workspacePath: null }
}

const api: ArgusApi = {
  windowInit: parseWindowInit(),

  openFolderDialog: () => ipcRenderer.invoke('app:open-folder-dialog'),
  openWorkspace: (path) => ipcRenderer.invoke('app:open-workspace', path),
  recentWorkspaces: (limit) => ipcRenderer.invoke('app:recent-workspaces', limit),
  onMenuCommand: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, command: MenuCommand): void =>
      handler(command)
    ipcRenderer.on('menu', listener)
    return () => ipcRenderer.removeListener('menu', listener)
  },

  startWatching: () => ipcRenderer.invoke('watch:start'),
  onGitState: makeListener<GitState>('git:state'),
  onGitStatusDiff: makeListener<GitStatusDiff>('git:status-diff'),
  onTaskUpdate: makeListener<BackgroundTaskUpdate>('task:update'),
  onWatchEvents: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, events: WatchEvent[]): void =>
      handler(events)
    ipcRenderer.on('watch:events', listener)
    return () => ipcRenderer.removeListener('watch:events', listener)
  },

  loadWorkspaceState: () => ipcRenderer.invoke('workspace:load-state'),
  saveWorkspaceState: (state) => ipcRenderer.invoke('workspace:save-state', state),
  loadFileViewState: (relPath) => ipcRenderer.invoke('workspace:load-file-state', relPath),
  saveFileViewState: (relPath, state) =>
    ipcRenderer.invoke('workspace:save-file-state', relPath, state),

  listFiles: (root) => ipcRenderer.invoke('repo:list-files', root),
  gitStatus: (root) => ipcRenderer.invoke('repo:git-status', root),
  readFile: (root, relPath) => ipcRenderer.invoke('file:read', root, relPath),
  writeFile: (root, relPath, content) => ipcRenderer.invoke('file:write', root, relPath, content),
  startSearch: (searchId, options) => ipcRenderer.invoke('search:start', searchId, options),
  cancelSearch: (searchId) => ipcRenderer.invoke('search:cancel', searchId),
  onSearchProgress: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      searchId: number,
      progress: SearchProgress
    ): void => handler(searchId, progress)
    ipcRenderer.on('search:progress', listener)
    return () => ipcRenderer.removeListener('search:progress', listener)
  },
  replaceAll: (options, replacement) =>
    ipcRenderer.invoke('search:replace-all', options, replacement),

  fileExists: (absPath) => ipcRenderer.invoke('file:exists', absPath),
  readFileAbsolute: (absPath) => ipcRenderer.invoke('file:read-abs', absPath),
  writeFileAbsolute: (absPath, content) => ipcRenderer.invoke('file:write-abs', absPath, content)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error (define in dts)
  window.electron = electronAPI
  // @ts-expect-error (define in dts)
  window.api = api
}
