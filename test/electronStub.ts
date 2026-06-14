import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Minimal `electron` replacement for main-process tests (vitest runs in plain
 * Node — Electron is the one external runtime we fake, like HTTP in webmock).
 * Application code runs unmodified; tests inspect windows/menus/IPC through
 * the exported `electronStub` handle.
 */

export interface SentMessage {
  channel: string
  args: unknown[]
}

class StubWebContents {
  sent: SentMessage[] = []
  constructor(public browserWindow: StubBrowserWindow) {}
  send(channel: string, ...args: unknown[]): void {
    this.sent.push({ channel, args })
  }
}

let nextWindowId = 1
const allWindows: StubBrowserWindow[] = []
let focusedWindow: StubBrowserWindow | null = null

export class StubBrowserWindow extends EventEmitter {
  id = nextWindowId++
  webContents = new StubWebContents(this)
  options: Record<string, unknown>
  destroyed = false
  visible = false
  maximized = false
  loaded: { kind: 'url' | 'file'; target: string } | null = null
  private bounds: { x: number; y: number; width: number; height: number }

  constructor(options: Record<string, unknown> = {}) {
    super()
    this.options = options
    this.bounds = {
      x: (options.x as number) ?? 0,
      y: (options.y as number) ?? 0,
      width: (options.width as number) ?? 800,
      height: (options.height as number) ?? 600
    }
    allWindows.push(this)
    focusedWindow = this
  }

  static getAllWindows(): StubBrowserWindow[] {
    return allWindows.filter((w) => !w.destroyed)
  }

  static getFocusedWindow(): StubBrowserWindow | null {
    return focusedWindow && !focusedWindow.destroyed ? focusedWindow : null
  }

  static fromWebContents(webContents: StubWebContents): StubBrowserWindow | null {
    return webContents.browserWindow.destroyed ? null : webContents.browserWindow
  }

  static fromId(id: number): StubBrowserWindow | null {
    return allWindows.find((w) => w.id === id && !w.destroyed) ?? null
  }

  loadURL(url: string): void {
    this.loaded = { kind: 'url', target: url }
  }
  loadFile(path: string): void {
    this.loaded = { kind: 'file', target: path }
  }
  show(): void {
    this.visible = true
  }
  focus(): void {
    focusedWindow = this
  }
  close(): void {
    this.destroyed = true
    if (focusedWindow === this) focusedWindow = null
    this.emit('closed')
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  isVisible(): boolean {
    return this.visible
  }
  isMaximized(): boolean {
    return this.maximized
  }
  maximize(): void {
    this.maximized = true
  }
  getBounds(): { x: number; y: number; width: number; height: number } {
    return { ...this.bounds }
  }
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.bounds = { ...bounds }
  }
}

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const ipcHandlers = new Map<string, IpcHandler>()

const userDataDir = mkdtempSync(join(tmpdir(), 'argus-electron-stub-'))

export const app = {
  name: 'argus',
  isPackaged: false,
  getPath: (name: string): string => join(userDataDir, name),
  setPath: (): void => {},
  getAppMetrics: (): Array<{
    type: string
    pid: number
    cpu: { percentCPUUsage: number }
    memory: { workingSetSize: number }
  }> => [
    {
      type: 'Browser',
      pid: process.pid,
      cpu: { percentCPUUsage: 1 },
      memory: { workingSetSize: 1024 }
    }
  ],
  requestSingleInstanceLock: (): boolean => true,
  whenReady: (): Promise<void> => Promise.resolve(),
  on: (): void => {},
  quit: (): void => {
    electronStub.quitCalls += 1
  },
  dock: { hide: (): void => {} }
}

export const ipcMain = {
  handle: (channel: string, handler: IpcHandler): void => {
    ipcHandlers.set(channel, handler)
  },
  removeHandler: (channel: string): void => {
    ipcHandlers.delete(channel)
  }
}

export interface CapturedMenuItem {
  label?: string
  accelerator?: string
  role?: string
  enabled?: boolean
  type?: string
  click?: () => void
  submenu?: CapturedMenuItem[]
}

let applicationMenu: { items: CapturedMenuItem[] } | null = null

export const Menu = {
  buildFromTemplate: (template: CapturedMenuItem[]): { items: CapturedMenuItem[] } => ({
    items: template
  }),
  setApplicationMenu: (menu: { items: CapturedMenuItem[] } | null): void => {
    applicationMenu = menu
  },
  getApplicationMenu: (): { items: CapturedMenuItem[] } | null => applicationMenu
}

export const clipboard = {
  writeText: (text: string): void => {
    electronStub.clipboardWrites.push(text)
  }
}

export const shell = {
  showItemInFolder: (path: string): void => {
    electronStub.revealedPaths.push(path)
  },
  openPath: (): Promise<string> => Promise.resolve('')
}

export const dialog = {
  showOpenDialog: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
    Promise.resolve(electronStub.nextOpenDialogResult)
}

export const BrowserWindow = StubBrowserWindow

/** Test-side handle to drive and inspect the stub. */
export const electronStub = {
  windows: (): StubBrowserWindow[] => allWindows,
  liveWindows: (): StubBrowserWindow[] => StubBrowserWindow.getAllWindows(),
  ipcHandlers,
  /** invoke a registered ipcMain handler as if from `window`'s renderer */
  invoke: async (
    window: StubBrowserWindow,
    channel: string,
    ...args: unknown[]
  ): Promise<unknown> => {
    const handler = ipcHandlers.get(channel)
    if (!handler) throw new Error(`no handler for ${channel}`)
    // async: a synchronously-throwing handler must reject, as real ipc does
    return handler({ sender: window.webContents }, ...args)
  },
  applicationMenu: (): { items: CapturedMenuItem[] } | null => applicationMenu,
  setFocusedWindow: (window: StubBrowserWindow | null): void => {
    focusedWindow = window
  },
  clipboardWrites: [] as string[],
  revealedPaths: [] as string[],
  nextOpenDialogResult: { canceled: true, filePaths: [] as string[] },
  quitCalls: 0,
  userDataDir
}

export default { app, BrowserWindow, ipcMain, Menu, clipboard, shell, dialog }
