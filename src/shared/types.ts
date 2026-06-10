export interface GitStatusEntry {
  path: string
  status: 'added' | 'deleted' | 'ignored' | 'modified' | 'renamed' | 'untracked'
}

export type FileReadResult =
  | { ok: true; content: string }
  | { ok: false; reason: 'binary' | 'too-large' | 'error'; message?: string }

export type FileWriteResult = { ok: true } | { ok: false; message: string }

// --- Windows & app state ---

export interface WindowInitData {
  kind: 'welcome' | 'workspace'
  workspacePath: string | null
}

export interface RecentWorkspaceEntry {
  path: string
  lastOpen: number
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface AppState {
  windows: Array<{
    workspacePath: string
    bounds?: WindowBounds
    maximized?: boolean
  }>
}

// --- Per-workspace persisted state (spec 15) ---

export interface PanelLayoutState {
  leftVisible: boolean
  leftWidth: number
  bottomVisible: boolean
  bottomHeight: number
  rightVisible: boolean
  rightWidth: number
}

export interface PersistedWorkspaceState {
  editor: {
    openTabs: Array<{ path: string; external?: boolean }>
    activeTab: number
  }
  panels: PanelLayoutState
  recentFiles: string[]
  starredFolders: string[]
  excludedPaths: string[]
}

export const DEFAULT_PANEL_LAYOUT: PanelLayoutState = {
  leftVisible: true,
  leftWidth: 250,
  bottomVisible: false,
  bottomHeight: 300,
  rightVisible: false,
  rightWidth: 250
}

export const DEFAULT_EXCLUDED_PATHS = [
  'vendor',
  'node_modules',
  'tmp',
  '.bundle',
  'log',
  'dist',
  'build',
  '.next',
  '.pnpm-store'
]

export function defaultWorkspaceState(): PersistedWorkspaceState {
  return {
    editor: { openTabs: [], activeTab: 0 },
    panels: { ...DEFAULT_PANEL_LAYOUT },
    recentFiles: [],
    starredFolders: [],
    excludedPaths: [...DEFAULT_EXCLUDED_PATHS]
  }
}

// --- File watching ---

export interface WatchEvent {
  type: 'create' | 'update' | 'delete'
  relPath: string
}

// --- Menu commands (main → renderer) ---

export type MenuCommand =
  | 'new-file'
  | 'save'
  | 'save-all'
  | 'close-tab'
  | 'find'
  | 'replace'
  | 'global-search'
  | 'global-replace'
  | 'toggle-file-tree'
  | 'toggle-search-panel'
  | 'toggle-schema-panel'
  | 'show-projects'
  | 'reveal-active-file'
  | 'go-to-file'
  | 'go-to-symbol'
  | 'recent-files'
  | 'go-to-line'
  | 'jump-back'
  | 'jump-forward'
  | 'go-to-definition'
  | 'go-to-type-definition'
  | 'show-hover'
  | 'quick-fixes'
  | 'rename-symbol'
  | 'format-document'
  | 'comment-line'
  | 'duplicate-line'
  | 'move-line-up'
  | 'move-line-down'
  | 'toggle-inlay-hints'
  | 'open-settings'
  | 'next-tab'
  | 'previous-tab'

// --- The typed API exposed to the renderer ---

export interface ArgusApi {
  windowInit: WindowInitData

  // app / windows
  openFolderDialog(): Promise<void>
  openWorkspace(path: string): Promise<void>
  recentWorkspaces(limit: number): Promise<RecentWorkspaceEntry[]>
  onMenuCommand(handler: (command: MenuCommand) => void): () => void
  startWatching(): Promise<void>
  onWatchEvents(handler: (events: WatchEvent[]) => void): () => void

  // per-workspace persisted state (scoped to this window's workspace)
  loadWorkspaceState(): Promise<PersistedWorkspaceState | null>
  saveWorkspaceState(state: PersistedWorkspaceState): Promise<void>
  loadFileViewState(relPath: string): Promise<{ cursorOffset: number; scrollTop: number } | null>
  saveFileViewState(
    relPath: string,
    state: { cursorOffset: number; scrollTop: number }
  ): Promise<void>

  // repo
  listFiles(root: string): Promise<string[]>
  gitStatus(root: string): Promise<GitStatusEntry[]>
  readFile(root: string, relPath: string): Promise<FileReadResult>
  writeFile(root: string, relPath: string, content: string): Promise<FileWriteResult>
}
