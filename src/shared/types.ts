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
  searchTabs?: PersistedSearchTab[]
  activeSearchTab?: number
  searchOptions?: { caseSensitive: boolean; wholeWord: boolean; regex: boolean }
  lastSearchPattern?: string
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

// --- LSP (spec 08) ---

export interface ProjectInfo {
  root: string
  relRoot: string
  kinds: Array<
    'ruby' | 'javascript' | 'rust' | 'go' | 'python' | 'elixir' | 'java' | 'swift' | 'shellscript'
  >
  isRails: boolean
  toolVersions: Record<string, string>
}

export interface LspDiagnostic {
  startLine: number // 0-based
  startChar: number
  endLine: number
  endChar: number
  severity: 1 | 2 | 3 | 4 // error, warning, info, hint
  message: string
  source: string
}

export interface LspLocation {
  /** workspace-relative when inside the workspace, absolute otherwise */
  path: string
  line: number // 0-based
  character: number
}

export interface LspCompletionItem {
  label: string
  kind?: number
  detail?: string
  insertText: string
}

export interface LspSymbol {
  name: string
  kind: number
  containerName?: string
  location: LspLocation
}

export interface LspHoverResult {
  contents: string
}

// --- Rails schema (spec 11) ---

export interface RailsSchemaInfo {
  table: string
  columns: Array<{
    name: string
    type: string
    notNull: boolean
    default: string | null
    line: number
  }>
  indexes: Array<{ columns: string[]; unique: boolean; line: number }>
}

// --- Git state (spec 09) ---

export interface GitState {
  isRepo: boolean
  branch: string | null
  state: 'rebasing' | 'merging' | 'cherry-picking' | 'reverting' | null
}

export type GitStatusDiff = Record<string, GitStatusEntry['status'] | null>

// --- Background tasks (spec 10) ---

export interface BackgroundTaskUpdate {
  id: number
  status: 'queued' | 'started' | 'progress' | 'finished'
  name: string
  message?: string
  percentage?: number
}

// --- File watching ---

export interface WatchEvent {
  type: 'create' | 'update' | 'delete'
  relPath: string
}

// --- Global search (spec 03) ---

export interface SearchOptions {
  pattern: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  scopeFolder?: string | null
  excludedPaths?: string[]
  maxResults?: number
}

export interface SearchMatch {
  path: string
  line: number
  /** line text, possibly truncated around the match for display */
  text: string
  /** offsets into `text` (display) */
  submatches: { start: number; end: number }[]
  /** offsets into the ORIGINAL line, for edits */
  origSubmatches: { start: number; end: number }[]
}

export interface SearchProgress {
  matches: SearchMatch[]
  done: boolean
  total: number
  capped: boolean
}

export interface PersistedSearchTab {
  pattern: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  scopeFolder: string | null
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
  | 'copy-relative-path'

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
  // LSP
  lspDidOpen(relPath: string, text: string): Promise<void>
  lspDidChange(relPath: string, text: string): Promise<void>
  lspDidClose(relPath: string): Promise<void>
  lspHover(relPath: string, line: number, character: number): Promise<LspHoverResult | null>
  lspDefinition(
    relPath: string,
    line: number,
    character: number,
    kind: 'definition' | 'typeDefinition'
  ): Promise<LspLocation[]>
  lspCompletion(relPath: string, line: number, character: number): Promise<LspCompletionItem[]>
  lspWorkspaceSymbols(query: string): Promise<LspSymbol[]>
  onLspDiagnostics(
    handler: (payload: { path: string; diagnostics: LspDiagnostic[] }) => void
  ): () => void
  onLspProjects(handler: (projects: ProjectInfo[]) => void): () => void
  railsSchemaFor(relPath: string): Promise<RailsSchemaInfo | null>
  revealInFinder(relPath: string): Promise<void>

  onGitState(handler: (state: GitState) => void): () => void
  onGitStatusDiff(handler: (diff: GitStatusDiff) => void): () => void
  onTaskUpdate(handler: (update: BackgroundTaskUpdate) => void): () => void

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
  fileExists(absPath: string): Promise<boolean>
  readFileAbsolute(absPath: string): Promise<FileReadResult>
  writeFileAbsolute(absPath: string, content: string): Promise<FileWriteResult>

  // global search (streams batches via onSearchProgress)
  startSearch(searchId: number, options: SearchOptions): Promise<void>
  cancelSearch(searchId: number): Promise<void>
  onSearchProgress(handler: (searchId: number, progress: SearchProgress) => void): () => void
  replaceAll(
    options: SearchOptions,
    replacement: string
  ): Promise<{ filesChanged: number; replacements: number }>
}
