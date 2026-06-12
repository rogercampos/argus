import { existsSync, statSync } from 'node:fs'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow } from 'electron'
import { registerIpcHandlers } from './ipc'
import { rebuildApplicationMenu } from './menu'
import { startProcStats } from './procStats'
import { initStateDir } from './state'
import {
  markQuitting,
  openWelcomeWindow,
  openWorkspaceWindow,
  persistAppState,
  restoreSession
} from './windows'

// Test/dev isolation: point all persisted state somewhere else (E2E runs).
if (process.env.ARGUS_USER_DATA) {
  app.setPath('userData', process.env.ARGUS_USER_DATA)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    // A second launch routes here; open a folder argument if present.
    // Electron's own args ('.', the app path) must not count as folders.
    const dirArg = argv
      .slice(1)
      .find((a) => a.startsWith('/') && !a.startsWith('--') && existsSync(a))
    if (dirArg && statSync(dirArg).isDirectory()) openWorkspaceWindow(dirArg)
    else openWelcomeWindow()
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.argus')
    initStateDir(app.getPath('userData'))

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpcHandlers()
    startProcStats()
    await rebuildApplicationMenu()
    await restoreSession()

    app.on('activate', () => {
      // Dock icon click with no windows: show welcome
      if (BrowserWindow.getAllWindows().length === 0) openWelcomeWindow()
    })
  })

  app.on('before-quit', () => {
    markQuitting()
    void persistAppState()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
