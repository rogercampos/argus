import { electronApp, optimizer } from '@electron-toolkit/utils'
import { app } from 'electron'
import icon from '../../resources/icon.png?asset'
import { parseDiffTarget } from '../shared/diffTarget'
import { reportCrash } from './crashReporter'
import { openDiffForDirectory, registerIpcHandlers } from './ipc'
import { parseLaunchArgs } from './launchArgs'
import { rebuildApplicationMenu } from './menu'
import { setSpawnErrorListener } from './procRegistry'
import { startProcStats } from './procStats'
import { initStateDir } from './state'
import {
  markQuitting,
  openWelcomeWindow,
  openWorkspaceWindow,
  persistAppState,
  restoreSession
} from './windows'

// --- Crash surfacing (spec: see crashReporter.ts) ---------------------------
// Installed before anything else so the earliest failures are still caught.
process.on('uncaughtException', (error) => {
  reportCrash({
    origin: 'main',
    title: 'Main process error',
    summary: `Uncaught exception: ${error.message}`,
    detail: error.stack ?? String(error)
  })
})
process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : undefined
  reportCrash({
    origin: 'main',
    title: 'Main process error',
    summary: `Unhandled promise rejection: ${error?.message ?? String(reason)}`,
    detail: error?.stack ?? String(reason)
  })
})
app.on('render-process-gone', (_event, _webContents, details) => {
  // The dead renderer can't show this, so broadcast to every window.
  reportCrash({
    origin: 'renderer',
    title: 'Window crashed',
    summary: `Renderer process gone: ${details.reason} (exit code ${details.exitCode})`,
    detail: `reason: ${details.reason}\nexitCode: ${details.exitCode}`
  })
})
app.on('child-process-gone', (_event, details) => {
  if (details.reason === 'clean-exit') return
  reportCrash({
    origin: 'main',
    title: 'Electron child process crashed',
    label: details.name ?? details.type,
    summary: `${details.type} ${details.reason} (exit code ${details.exitCode})`,
    detail: `type: ${details.type}\nname: ${details.name ?? '(unnamed)'}\nreason: ${details.reason}\nexitCode: ${details.exitCode}`
  })
})
const SPAWN_KIND_TITLE: Record<string, string> = {
  lsp: 'Language server failed to start',
  git: 'Git command failed to start',
  search: 'Search process failed to start',
  semgrep: 'Semgrep failed to start',
  install: 'Installer failed to start',
  'shell-env': 'Shell environment lookup failed'
}
setSpawnErrorListener((meta, error) => {
  reportCrash({
    origin: meta.kind,
    title: SPAWN_KIND_TITLE[meta.kind] ?? 'Process failed to start',
    label: meta.label,
    summary: error.message,
    detail: error.stack ?? error.message,
    windowId: meta.windowId
  })
})

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
  app.on('second-instance', (_event, argv, workingDirectory) => {
    // A second launch routes here: open what it asked for, else welcome
    const request = parseLaunchArgs(argv, workingDirectory, app.getAppPath())
    if (request.kind === 'workspace') openWorkspaceWindow(request.dir)
    else if (request.kind === 'diff') {
      void openDiffForDirectory(request.dir, parseDiffTarget(request.target))
    } else openWelcomeWindow()
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.argus')
    initStateDir(app.getPath('userData'))
    // Packaged builds get the dock icon from build/icon.icns; dev runs the
    // stock Electron binary, so set it at runtime
    if (!app.isPackaged) app.dock?.setIcon(icon)

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpcHandlers()
    startProcStats()
    await rebuildApplicationMenu()
    // A folder or `--diff` on the command line opens just that, skipping
    // session restore (ARGUS_DIFF is the dev equivalent: ARGUS_DIFF=~/code/repo pnpm dev)
    const launch = process.env.ARGUS_DIFF
      ? {
          kind: 'diff' as const,
          dir: process.env.ARGUS_DIFF,
          target: process.env.ARGUS_DIFF_TARGET ?? ''
        }
      : parseLaunchArgs(process.argv, process.cwd(), app.getAppPath())
    if (launch.kind === 'diff') {
      const opened = await openDiffForDirectory(launch.dir, parseDiffTarget(launch.target))
      if (!opened) openWelcomeWindow()
    } else if (launch.kind === 'workspace') {
      openWorkspaceWindow(launch.dir)
    } else {
      await restoreSession()
    }
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
