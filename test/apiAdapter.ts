import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  fileExists,
  gitStatus,
  listFiles,
  listIgnoredEntries,
  listTopLevel,
  readFile,
  readFileAbsolute,
  writeFile,
  writeFileAbsolute
} from '../src/main/repo'
import { schemaForModel } from '../src/main/schema'
import { type RunningSearch, replaceAll, runSearch } from '../src/main/search'
import {
  initStateDir,
  listRecentWorkspaces,
  loadFileViewState,
  loadWorkspaceState,
  removeRecentWorkspace,
  saveFileViewState,
  saveWorkspaceState,
  touchRecentWorkspace
} from '../src/main/state'
import { defaultKeymapConfig } from '../src/shared/shortcuts'
import type {
  ArgusApi,
  BackgroundTaskUpdate,
  CrashReport,
  GitState,
  GitStatusDiff,
  LspCompletionItem,
  LspDiagnostic,
  LspHoverResult,
  LspLocation,
  LspSymbol,
  MenuCommand,
  ProcStatsSnapshot,
  ProjectInfo,
  SearchOptions,
  SearchProgress,
  WatchEvent
} from '../src/shared/types'

/**
 * An ArgusApi implementation for renderer tests, backed by the REAL main
 * process modules (repo/search/state/schema run as plain Node code against a
 * real fixture repo) — only the IPC wire and the Electron shell are absent.
 *
 * Push channels (git state, watch events, menu commands, …) are exposed as
 * emit* helpers so tests can drive them; in production those originate from
 * main-process services that need a BrowserWindow (covered by the main
 * integration suite). LSP methods return empty results until the fake LSP
 * server lands (test plan phase 3).
 */

type Handler<T extends unknown[]> = (...args: T) => void

class Channel<T extends unknown[]> {
  private handlers = new Set<Handler<T>>()
  subscribe(handler: Handler<T>): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }
  emit(...args: T): void {
    for (const handler of [...this.handlers]) handler(...args)
  }
}

export interface RecordedCalls {
  openedWorkspaces: string[]
  openFolderDialogs: number
  revealedPaths: string[]
  clipboardWrites: string[]
  watchStarts: number
  lspDidOpen: string[]
  lspDidChange: string[]
  lspDidClose: string[]
}

/** Canned LSP responses (stands in for the language-server external process). */
export interface CannedLsp {
  hover: LspHoverResult | null
  definitions: LspLocation[]
  completions: LspCompletionItem[]
  symbols: LspSymbol[]
}

export interface TestApi {
  api: ArgusApi
  calls: RecordedCalls
  /** mutate to control what the LSP methods answer */
  lsp: CannedLsp
  /** mutate to control what slowOps() reports */
  slowOps: Array<{ time: number; operation: string; ms: number }>
  /** dir holding persisted state, in case a test wants to inspect it */
  stateDir: string
  emitMenuCommand(command: MenuCommand): void
  emitWatchEvents(events: WatchEvent[]): void
  emitGitState(state: GitState): void
  emitGitStatusDiff(diff: GitStatusDiff): void
  emitTaskUpdate(update: BackgroundTaskUpdate): void
  emitProcStats(snapshot: ProcStatsSnapshot): void
  emitCrash(report: CrashReport): void
  emitLspDiagnostics(payload: { path: string; diagnostics: LspDiagnostic[] }): void
  emitLspProjects(projects: ProjectInfo[]): void
  emitSearchProgress(searchId: number, progress: SearchProgress): void
  /** cancel anything still running (call from afterEach) */
  dispose(): void
}

export function createTestApi(workspacePath: string): TestApi {
  const stateDir = mkdtempSync(join(tmpdir(), 'argus-state-'))
  initStateDir(stateDir)

  const calls: RecordedCalls = {
    openedWorkspaces: [],
    openFolderDialogs: 0,
    revealedPaths: [],
    clipboardWrites: [],
    watchStarts: 0,
    lspDidOpen: [],
    lspDidChange: [],
    lspDidClose: []
  }

  const lsp: CannedLsp = { hover: null, definitions: [], completions: [], symbols: [] }
  const slowOps: Array<{ time: number; operation: string; ms: number }> = []

  const menuCommands = new Channel<[MenuCommand]>()
  const watchEvents = new Channel<[WatchEvent[]]>()
  const gitState = new Channel<[GitState]>()
  const gitStatusDiff = new Channel<[GitStatusDiff]>()
  const taskUpdates = new Channel<[BackgroundTaskUpdate]>()
  const procStats = new Channel<[ProcStatsSnapshot]>()
  const crashes = new Channel<[CrashReport]>()
  const lspDiagnostics = new Channel<[{ path: string; diagnostics: LspDiagnostic[] }]>()
  const lspProjects = new Channel<[ProjectInfo[]]>()
  const searchProgress = new Channel<[number, SearchProgress]>()

  const activeSearches = new Map<number, RunningSearch>()

  const api: ArgusApi = {
    windowInit: { kind: 'workspace', workspacePath, homeDir: process.env.HOME ?? '' },

    // app / windows
    openFolderDialog: async () => {
      calls.openFolderDialogs += 1
    },
    openWorkspace: async (path) => {
      calls.openedWorkspaces.push(path)
      await touchRecentWorkspace(path)
    },
    recentWorkspaces: (limit) => listRecentWorkspaces(limit),
    removeRecentWorkspace: (path) => removeRecentWorkspace(path),
    onMenuCommand: (handler) => menuCommands.subscribe(handler),
    startWatching: async () => {
      calls.watchStarts += 1
    },
    onWatchEvents: (handler) => watchEvents.subscribe(handler),

    // LSP — canned responses (the language server is an external process)
    lspDidOpen: async (relPath) => {
      calls.lspDidOpen.push(relPath)
    },
    lspDidChange: async (relPath) => {
      calls.lspDidChange.push(relPath)
    },
    lspDidClose: async (relPath) => {
      calls.lspDidClose.push(relPath)
    },
    lspHover: async () => lsp.hover,
    lspDefinition: async () => lsp.definitions,
    lspCompletion: async () => lsp.completions,
    lspWorkspaceSymbols: async () => lsp.symbols,
    onLspDiagnostics: (handler) => lspDiagnostics.subscribe(handler),
    onLspProjects: (handler) => lspProjects.subscribe(handler),
    railsSchemaFor: (relPath) => schemaForModel(workspacePath, relPath),
    revealInFinder: async (relPath) => {
      calls.revealedPaths.push(relPath)
    },
    copyToClipboard: async (text) => {
      calls.clipboardWrites.push(text)
    },
    slowOps: async () => slowOps,

    onGitState: (handler) => gitState.subscribe(handler),
    onGitStatusDiff: (handler) => gitStatusDiff.subscribe(handler),
    onTaskUpdate: (handler) => taskUpdates.subscribe(handler),
    onProcStats: (handler) => procStats.subscribe(handler),
    onCrash: (handler) => crashes.subscribe(handler),

    // per-workspace persisted state
    loadWorkspaceState: () => loadWorkspaceState(workspacePath),
    saveWorkspaceState: (state) => saveWorkspaceState(workspacePath, state),
    loadFileViewState: (relPath) => loadFileViewState(workspacePath, relPath),
    saveFileViewState: (relPath, state) => saveFileViewState(workspacePath, relPath, state),
    loadKeymap: async () => defaultKeymapConfig(),
    saveKeymap: async () => {},
    suspendMenu: async () => {},
    resumeMenu: async () => {},

    // repo
    listFiles: (root) => listFiles(root),
    listIgnoredEntries: (root) => listIgnoredEntries(root),
    listTopLevel: (root) => listTopLevel(root),
    gitStatus: (root) => gitStatus(root),
    readFile: (root, relPath) => readFile(root, relPath),
    writeFile: (root, relPath, content) => writeFile(root, relPath, content),
    fileExists: (absPath) => fileExists(absPath),
    readFileAbsolute: (absPath) => readFileAbsolute(absPath),
    writeFileAbsolute: (absPath, content) => writeFileAbsolute(absPath, content),

    // global search — real ripgrep against the fixture repo
    startSearch: async (searchId, options: SearchOptions) => {
      activeSearches.get(searchId)?.cancel()
      const search = runSearch(workspacePath, options, (progress) => {
        searchProgress.emit(searchId, progress)
        if (progress.done) activeSearches.delete(searchId)
      })
      activeSearches.set(searchId, search)
    },
    cancelSearch: async (searchId) => {
      activeSearches.get(searchId)?.cancel()
      activeSearches.delete(searchId)
    },
    onSearchProgress: (handler) => searchProgress.subscribe(handler),
    replaceAll: (options, replacement) => replaceAll(workspacePath, options, replacement, () => {})
  }

  return {
    api,
    calls,
    lsp,
    slowOps,
    stateDir,
    emitMenuCommand: (command) => menuCommands.emit(command),
    emitWatchEvents: (events) => watchEvents.emit(events),
    emitGitState: (state) => gitState.emit(state),
    emitGitStatusDiff: (diff) => gitStatusDiff.emit(diff),
    emitTaskUpdate: (update) => taskUpdates.emit(update),
    emitProcStats: (snapshot) => procStats.emit(snapshot),
    emitCrash: (report) => crashes.emit(report),
    emitLspDiagnostics: (payload) => lspDiagnostics.emit(payload),
    emitLspProjects: (projects) => lspProjects.emit(projects),
    emitSearchProgress: (searchId, progress) => searchProgress.emit(searchId, progress),
    dispose: () => {
      for (const search of activeSearches.values()) search.cancel()
      activeSearches.clear()
    }
  }
}

/** Install the adapter as window.api for component tests. */
export function installTestApi(testApi: TestApi): void {
  ;(globalThis as { api?: ArgusApi }).api = testApi.api
  if (typeof window !== 'undefined') {
    ;(window as unknown as { api: ArgusApi }).api = testApi.api
  }
}
