import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  fileExists,
  gitStatus,
  listFiles,
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
import type {
  ArgusApi,
  BackgroundTaskUpdate,
  GitState,
  GitStatusDiff,
  LspDiagnostic,
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
}

export interface TestApi {
  api: ArgusApi
  calls: RecordedCalls
  /** dir holding persisted state, in case a test wants to inspect it */
  stateDir: string
  emitMenuCommand(command: MenuCommand): void
  emitWatchEvents(events: WatchEvent[]): void
  emitGitState(state: GitState): void
  emitGitStatusDiff(diff: GitStatusDiff): void
  emitTaskUpdate(update: BackgroundTaskUpdate): void
  emitProcStats(snapshot: ProcStatsSnapshot): void
  emitLspDiagnostics(payload: { path: string; diagnostics: LspDiagnostic[] }): void
  emitLspProjects(projects: ProjectInfo[]): void
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
    watchStarts: 0
  }

  const menuCommands = new Channel<[MenuCommand]>()
  const watchEvents = new Channel<[WatchEvent[]]>()
  const gitState = new Channel<[GitState]>()
  const gitStatusDiff = new Channel<[GitStatusDiff]>()
  const taskUpdates = new Channel<[BackgroundTaskUpdate]>()
  const procStats = new Channel<[ProcStatsSnapshot]>()
  const lspDiagnostics = new Channel<[{ path: string; diagnostics: LspDiagnostic[] }]>()
  const lspProjects = new Channel<[ProjectInfo[]]>()
  const searchProgress = new Channel<[number, SearchProgress]>()

  const activeSearches = new Map<number, RunningSearch>()

  const api: ArgusApi = {
    windowInit: { kind: 'workspace', workspacePath },

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

    // LSP — wired to a fake server in test plan phase 3
    lspDidOpen: async () => {},
    lspDidChange: async () => {},
    lspDidClose: async () => {},
    lspHover: async () => null,
    lspDefinition: async () => [],
    lspCompletion: async () => [],
    lspWorkspaceSymbols: async () => [],
    onLspDiagnostics: (handler) => lspDiagnostics.subscribe(handler),
    onLspProjects: (handler) => lspProjects.subscribe(handler),
    railsSchemaFor: (relPath) => schemaForModel(workspacePath, relPath),
    revealInFinder: async (relPath) => {
      calls.revealedPaths.push(relPath)
    },
    copyToClipboard: async (text) => {
      calls.clipboardWrites.push(text)
    },
    slowOps: async () => [],

    onGitState: (handler) => gitState.subscribe(handler),
    onGitStatusDiff: (handler) => gitStatusDiff.subscribe(handler),
    onTaskUpdate: (handler) => taskUpdates.subscribe(handler),
    onProcStats: (handler) => procStats.subscribe(handler),

    // per-workspace persisted state
    loadWorkspaceState: () => loadWorkspaceState(workspacePath),
    saveWorkspaceState: (state) => saveWorkspaceState(workspacePath, state),
    loadFileViewState: (relPath) => loadFileViewState(workspacePath, relPath),
    saveFileViewState: (relPath, state) => saveFileViewState(workspacePath, relPath, state),

    // repo
    listFiles: (root) => listFiles(root),
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
    stateDir,
    emitMenuCommand: (command) => menuCommands.emit(command),
    emitWatchEvents: (events) => watchEvents.emit(events),
    emitGitState: (state) => gitState.emit(state),
    emitGitStatusDiff: (diff) => gitStatusDiff.emit(diff),
    emitTaskUpdate: (update) => taskUpdates.emit(update),
    emitProcStats: (snapshot) => procStats.emit(snapshot),
    emitLspDiagnostics: (payload) => lspDiagnostics.emit(payload),
    emitLspProjects: (projects) => lspProjects.emit(projects),
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
