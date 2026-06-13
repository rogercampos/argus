import { existsSync, statSync } from 'node:fs'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { app } from 'electron'
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
// E2E runs keep windows hidden; without a dock icon the run is fully invisible
// and never steals focus from the user.
if (process.env.ARGUS_HIDE_WINDOWS === '1') {
  app.whenReady().then(() => app.dock?.hide())
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
  })

  // persistAppState writes asynchronously; hold the quit until it lands once,
  // otherwise the last window move/resize/open can be lost from the session.
  let finalPersistDone = false
  app.on('before-quit', (event) => {
    markQuitting()
    if (finalPersistDone) return
    event.preventDefault()
    // .catch before .finally: a failed write must still let the quit proceed
    // rather than escaping as an unhandled rejection
    void persistAppState()
      .catch(() => {})
      .finally(() => {
        finalPersistDone = true
        app.quit() // re-quit; this pass runs normally (windows close, children die)
      })
  })

  // Argus quits when nothing is open on every platform (spec 01: closing the
  // welcome window quits). Closing the last workspace window reopens the welcome
  // window (windows.ts), so this only fires once the user dismisses that too —
  // there is intentionally no "stay alive with no windows" macOS behavior, which
  // is why no `activate`/reopen handler is needed.
  app.on('window-all-closed', () => {
    app.quit()
  })
}
