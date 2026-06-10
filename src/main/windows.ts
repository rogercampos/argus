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
    void persistAppState()
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
      additionalArguments: [`--argus-workspace=${workspacePath}`]
    }
  })

  workspaceWindows.set(window.id, { window, workspacePath })
  void touchRecentWorkspace(workspacePath)

  if (options.maximized) window.maximize()
  window.on('ready-to-show', () => window.show())
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
      additionalArguments: ['--argus-welcome']
    }
  })

  welcomeWindow = window
  window.on('ready-to-show', () => window.show())
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

/** Restore the previous session, or fall back to ARGUS_OPEN / welcome. */
export async function restoreSession(): Promise<void> {
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
  if (process.env.ARGUS_OPEN) {
    openWorkspaceWindow(process.env.ARGUS_OPEN)
    return
  }
  openWelcomeWindow()
}
