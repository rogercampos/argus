import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'
import type { ArgusApi } from '../shared/types'

const api: ArgusApi = {
  initialFolder: process.env.ARGUS_OPEN ?? null,
  openFolder: () => ipcRenderer.invoke('dialog:open-folder'),
  listFiles: (root) => ipcRenderer.invoke('repo:list-files', root),
  gitStatus: (root) => ipcRenderer.invoke('repo:git-status', root),
  readFile: (root, relPath) => ipcRenderer.invoke('file:read', root, relPath),
  writeFile: (root, relPath, content) => ipcRenderer.invoke('file:write', root, relPath, content)
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
