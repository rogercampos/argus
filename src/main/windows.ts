import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { app, BrowserWindow } from 'electron'
import icon from '../../resources/icon.png?asset'
import type { AppState, WindowBounds } from '../shared/types'
import { loadAppState, saveAppState, touchRecentWorkspace } from './state'

/**
 * Window management (spec 01): one workspace per window, a singleton welcome
 * window when no workspace windows remain, session restore on launch.
 */

const workspaceWindows = new Map<number, { window: BrowserWindow; workspacePath: string }>()
let welcomeWindow: BrowserWindow | null = null
let quitting = false

/**
 * E2E runs set ARGUS_HIDE_WINDOWS: windows are never shown on screen (Electron
 * has no real headless mode). Background throttling must be off so rAF/timers
 * keep running in the never-visible renderer.
 */
const HIDE_WINDOWS = process.env.ARGUS_HIDE_WINDOWS === '1'

export function isQuitting(): boolean {
  return quitting
}

export function markQuitting(): void {
  quitting = true
}

export function workspaceForWindow(windowId: number): string | null {
  return workspaceWindows.get(windowId)?.workspacePath ?? null
}

export function findWorkspaceWindow(workspacePath: string): BrowserWindow | null {
  for (const { window, workspacePath: path } of workspaceWindows.values()) {
    if (path === workspacePath) return window
  }
  return null
}

function loadRenderer(window: BrowserWindow): void {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function currentAppState(): AppState {
  return {
    windows: [...workspaceWindows.values()].map(({ window, workspacePath }) => ({
      workspacePath,
      bounds: window.getBounds(),
      maximized: window.isMaximized()
    }))
  }
}

export async function persistAppState(): Promise<void> {
  await saveAppState(currentAppState())
}

let persistTimer: NodeJS.Timeout | null = null
function persistAppStateDebounced(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    // best-effort: a failed session write must not become an unhandled rejection
    void persistAppState().catch(() => {})
  }, 2000)
}

export function openWorkspaceWindow(
  workspacePath: string,
  options: { bounds?: WindowBounds; maximized?: boolean } = {}
): BrowserWindow {
  const existing = findWorkspaceWindow(workspacePath)
  if (existing) {
    existing.focus()
    return existing
  }

  const window = new BrowserWindow({
    width: options.bounds?.width ?? 1400,
    height: options.bounds?.height ?? 900,
    x: options.bounds?.x,
    y: options.bounds?.y,
    minWidth: 600,
    minHeight: 400,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#1a2548',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      additionalArguments: [`--argus-workspace=${workspacePath}`],
      backgroundThrottling: !HIDE_WINDOWS
    }
  })

  workspaceWindows.set(window.id, { window, workspacePath })
  // best-effort recents update; never let it surface as an unhandled rejection
  void touchRecentWorkspace(workspacePath).catch(() => {})

  if (options.maximized && !HIDE_WINDOWS) window.maximize()
  window.on('ready-to-show', () => {
    if (!HIDE_WINDOWS) window.show()
  })
  window.on('moved', persistAppStateDebounced)
  window.on('resized', persistAppStateDebounced)
  window.on('closed', () => {
    workspaceWindows.delete(window.id)
    if (!quitting) {
      persistAppStateDebounced()
      if (workspaceWindows.size === 0) openWelcomeWindow()
    }
  })

  loadRenderer(window)
  persistAppStateDebounced()

  // Welcome window's job is done once a workspace opens
  welcomeWindow?.close()
  return window
}

export function openWelcomeWindow(): BrowserWindow {
  if (welcomeWindow) {
    welcomeWindow.focus()
    return welcomeWindow
  }

  const window = new BrowserWindow({
    width: 720,
    height: 460,
    resizable: false,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#1a2548',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      additionalArguments: ['--argus-welcome'],
      backgroundThrottling: !HIDE_WINDOWS
    }
  })

  welcomeWindow = window
  window.on('ready-to-show', () => {
    if (!HIDE_WINDOWS) window.show()
  })
  window.on('closed', () => {
    welcomeWindow = null
    // Closing the welcome window quits the app (spec 01)
    if (!quitting && workspaceWindows.size === 0) {
      app.quit()
    }
  })

  loadRenderer(window)
  return window
}

/** Restore the previous session, or fall back to welcome. ARGUS_OPEN (dev) wins. */
export async function restoreSession(): Promise<void> {
  if (process.env.ARGUS_OPEN) {
    openWorkspaceWindow(process.env.ARGUS_OPEN)
    return
  }
  const state = await loadAppState()
  if (state && state.windows.length > 0) {
    for (const entry of state.windows) {
      const bounds =
        entry.bounds && entry.bounds.width >= 10 && entry.bounds.height >= 10
          ? entry.bounds
          : undefined
      openWorkspaceWindow(entry.workspacePath, { bounds, maximized: entry.maximized })
    }
    return
  }
  openWelcomeWindow()
}
