import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { create } from 'zustand'
import type { GitStatusEntry, PanelLayoutState, PersistedWorkspaceState } from '../../shared/types'
import { defaultWorkspaceState } from '../../shared/types'
import { DocumentManager } from './documents'
import { JumpHistory } from './history'
import type { TabsState } from './tabs'
import { closeOtherTabs, closeTab, cycleTab, MAX_OPEN_TABS, openTab, tabToEvict } from './tabs'

const MAX_RECENT_FILES = 100

export type ModalKind = 'go-to-file' | 'recent-files' | 'go-to-line' | null

interface WorkspaceStore {
  rootPath: string | null
  rootName: string | null
  paths: string[]
  filePaths: Set<string>
  gitStatus: GitStatusEntry[]
  loadingTree: boolean
  fileError: string | null
  panels: PanelLayoutState
  cursor: { line: number; col: number } | null
  language: string | null
  tabs: TabsState
  dirtyPaths: Record<string, boolean>
  recentFiles: string[]
  /** bumped whenever the active document is (re)loaded, to remount the view */
  activeDocEpoch: number
  openModal: ModalKind
  lastGoToFileQuery: string
  excludedPaths: string[]

  init: () => Promise<void>
  openFile: (relPath: string, options?: { intent?: boolean }) => Promise<void>
  navigateTo: (
    path: string,
    options?: { cursorOffset?: number; line?: number; col?: number; scrollTop?: number }
  ) => Promise<void>
  jumpBack: () => Promise<void>
  jumpForward: () => Promise<void>
  setModal: (modal: ModalKind) => void
  activateTab: (index: number) => Promise<void>
  closeTabAt: (index: number) => Promise<void>
  closeOthers: (index: number) => Promise<void>
  closeAllTabs: () => Promise<void>
  cycleTabs: (delta: 1 | -1) => Promise<void>
  setPanels: (update: Partial<PanelLayoutState>) => void
  setCursor: (cursor: { line: number; col: number } | null) => void
}

export const documents = new DocumentManager(
  async (path) => {
    if (path.startsWith('/')) {
      const result = await window.api.readFileAbsolute(path)
      return result.ok ? result.content : null
    }
    const root = useWorkspaceStore.getState().rootPath
    if (!root) return null
    const result = await window.api.readFile(root, path)
    return result.ok ? result.content : null
  },
  async (path, content) => {
    if (path.startsWith('/')) {
      const result = await window.api.writeFileAbsolute(path, content)
      return result.ok
    }
    const root = useWorkspaceStore.getState().rootPath
    if (!root) return false
    const result = await window.api.writeFile(root, path, content)
    return result.ok
  }
)

export const jumpHistory = new JumpHistory()

/** Where the user is right now, for history recording. */
function currentLocation(): { path: string; cursorOffset: number; scrollTop: number } | null {
  const path = activeTabPath()
  if (!path) return null
  const doc = documents.get(path)
  const view = activeView()
  return {
    path,
    cursorOffset: doc?.state.selection.main.head ?? 0,
    scrollTop: view?.scrollDOM.scrollTop ?? 0
  }
}

/** Extensions builder injected by EditorPane (theme, language, keymaps). */
let extensionsForPath: (path: string) => Extension[] = () => []
export function setExtensionsBuilder(builder: (path: string) => Extension[]): void {
  extensionsForPath = builder
}
export function getExtensionsForPath(path: string): Extension[] {
  return extensionsForPath(path)
}

let persisted: PersistedWorkspaceState = defaultWorkspaceState()
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** Merge feature-owned persisted fields (e.g. search tabs) and schedule a save. */
export function mergePersisted(partial: Partial<PersistedWorkspaceState>): void {
  persisted = { ...persisted, ...partial }
  schedulePersist()
}

function schedulePersist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const s = useWorkspaceStore.getState()
    persisted = {
      ...persisted,
      panels: s.panels,
      recentFiles: s.recentFiles,
      editor: {
        openTabs: s.tabs.tabs.map((t) => ({ path: t.path, external: t.external || undefined })),
        activeTab: s.tabs.activeIndex
      }
    }
    void window.api.saveWorkspaceState(persisted)
  }, 2000)
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  rb: 'Ruby',
  rake: 'Ruby',
  gemspec: 'Ruby',
  js: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  jsx: 'JavaScript',
  ts: 'TypeScript',
  tsx: 'TypeScript',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  md: 'Markdown',
  py: 'Python',
  rs: 'Rust',
  go: 'Go',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  yml: 'YAML',
  yaml: 'YAML',
  toml: 'TOML',
  sql: 'SQL'
}

export function languageForPath(path: string): string | null {
  const base = path.split('/').pop() ?? ''
  if (base === 'Gemfile' || base === 'Rakefile') return 'Ruby'
  if (base === 'Dockerfile') return 'Docker'
  const ext = (base.split('.').pop() ?? '').toLowerCase()
  return LANGUAGE_BY_EXT[ext] ?? null
}

export function isExternalPath(path: string): boolean {
  return path.startsWith('/') || path.split('/').includes('node_modules')
}

async function saveViewStateFor(path: string): Promise<void> {
  const doc = documents.get(path)
  if (!doc) return
  await window.api.saveFileViewState(path, {
    cursorOffset: doc.state.selection.main.head,
    scrollTop: doc.lastScrollTop
  })
}

let relistTimer: ReturnType<typeof setTimeout> | null = null
function scheduleTreeRelist(): void {
  if (relistTimer) clearTimeout(relistTimer)
  relistTimer = setTimeout(() => {
    const { rootPath } = useWorkspaceStore.getState()
    if (!rootPath) return
    void window.api.listFiles(rootPath).then((paths) => {
      useWorkspaceStore.setState({ paths, filePaths: new Set(paths) })
    })
  }, 1000)
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  rootPath: null,
  rootName: null,
  paths: [],
  filePaths: new Set(),
  gitStatus: [],
  loadingTree: false,
  fileError: null,
  panels: defaultWorkspaceState().panels,
  cursor: null,
  language: null,
  tabs: { tabs: [], activeIndex: 0 },
  dirtyPaths: {},
  recentFiles: [],
  activeDocEpoch: 0,
  openModal: null,
  lastGoToFileQuery: '',
  excludedPaths: defaultWorkspaceState().excludedPaths,

  init: async () => {
    const root = window.api.windowInit.workspacePath
    if (!root) return
    const rootName = root.split('/').filter(Boolean).pop() ?? root
    set({ rootPath: root, rootName, loadingTree: true })

    documents.onDirtyChange((path, dirty) => {
      set({ dirtyPaths: { ...get().dirtyPaths, [path]: dirty } })
    })

    const stored = await window.api.loadWorkspaceState()
    if (stored) {
      persisted = stored
      set({
        panels: stored.panels,
        recentFiles: stored.recentFiles ?? [],
        excludedPaths: stored.excludedPaths ?? defaultWorkspaceState().excludedPaths
      })
      // Restore tabs without recency side-effects; only the active doc loads
      const tabs = (stored.editor?.openTabs ?? []).map((t) => ({
        path: t.path,
        external: t.external ?? false
      }))
      if (tabs.length > 0) {
        const activeIndex = Math.min(stored.editor.activeTab ?? 0, tabs.length - 1)
        set({ tabs: { tabs, activeIndex } })
        await get().activateTab(activeIndex)
      }
    }

    void window.api.startWatching()
    window.api.onWatchEvents((events) => {
      let structureChanged = false
      for (const event of events) {
        if (event.type === 'update') {
          if (documents.get(event.relPath)) {
            void documents.reloadFromDisk(event.relPath, activeView()).then((changed) => {
              if (changed && get().tabs.tabs[get().tabs.activeIndex]?.path === event.relPath) {
                set({ activeDocEpoch: get().activeDocEpoch + 1 })
              }
            })
          }
        } else {
          structureChanged = true
        }
      }
      if (structureChanged) scheduleTreeRelist()
    })

    const [paths, gitStatus] = await Promise.all([
      window.api.listFiles(root),
      window.api.gitStatus(root)
    ])
    set({ paths, filePaths: new Set(paths), gitStatus, loadingTree: false })
  },

  openFile: async (relPath, options = {}) => {
    const intent = options.intent ?? true
    // Deliberate navigation records the departing location (spec 05)
    if (intent && activeTabPath() && activeTabPath() !== relPath) {
      const loc = currentLocation()
      if (loc) jumpHistory.record(loc)
    }
    const doc = await documents.open(relPath, extensionsForPath(relPath))
    if (!doc) {
      set({ fileError: `${relPath}: cannot open (binary, too large, or unreadable)` })
      return
    }
    set({ fileError: null })

    let tabs = openTab(get().tabs, relPath, isExternalPath(relPath))

    // LRU eviction over the cap (spec 06)
    if (tabs.tabs.length > MAX_OPEN_TABS) {
      const evictIndex = tabToEvict(tabs, get().recentFiles)
      if (evictIndex !== -1) {
        const evictPath = tabs.tabs[evictIndex].path
        await saveViewStateFor(evictPath)
        await documents.close(evictPath)
        tabs = closeTab(tabs, evictIndex)
      }
    }

    if (intent) {
      const recents = [relPath, ...get().recentFiles.filter((p) => p !== relPath)].slice(
        0,
        MAX_RECENT_FILES
      )
      set({ recentFiles: recents })
    }

    set({
      tabs,
      language: languageForPath(relPath),
      activeDocEpoch: get().activeDocEpoch + 1
    })
    schedulePersist()
  },

  activateTab: async (index) => {
    const { tabs } = get()
    const tab = tabs.tabs[index]
    if (!tab) return
    await documents.open(tab.path, extensionsForPath(tab.path))
    set({
      tabs: { ...tabs, activeIndex: index },
      language: languageForPath(tab.path),
      activeDocEpoch: get().activeDocEpoch + 1
    })
    schedulePersist()
  },

  closeTabAt: async (index) => {
    const { tabs } = get()
    const tab = tabs.tabs[index]
    if (!tab) return
    await saveViewStateFor(tab.path)
    await documents.close(tab.path)
    const next = closeTab(tabs, index)
    set({ tabs: next })
    if (next.tabs.length > 0) await get().activateTab(next.activeIndex)
    else set({ language: null, cursor: null, activeDocEpoch: get().activeDocEpoch + 1 })
    schedulePersist()
  },

  closeOthers: async (index) => {
    const { tabs } = get()
    for (let i = 0; i < tabs.tabs.length; i++) {
      if (i === index) continue
      await saveViewStateFor(tabs.tabs[i].path)
      await documents.close(tabs.tabs[i].path)
    }
    set({ tabs: closeOtherTabs(tabs, index) })
    await get().activateTab(0)
  },

  closeAllTabs: async () => {
    const { tabs } = get()
    for (const tab of tabs.tabs) {
      await saveViewStateFor(tab.path)
      await documents.close(tab.path)
    }
    set({
      tabs: { tabs: [], activeIndex: 0 },
      language: null,
      cursor: null,
      activeDocEpoch: get().activeDocEpoch + 1
    })
    schedulePersist()
  },

  cycleTabs: async (delta) => {
    const next = cycleTab(get().tabs, delta)
    if (next.activeIndex !== get().tabs.activeIndex) {
      await get().activateTab(next.activeIndex)
    }
  },

  navigateTo: async (path, options = {}) => {
    await get().openFile(path, { intent: true })
    const view = activeView()
    if (!view) return
    let offset = options.cursorOffset
    if (offset === undefined && options.line !== undefined) {
      const lineNumber = Math.max(1, Math.min(options.line, view.state.doc.lines))
      const line = view.state.doc.line(lineNumber)
      const col = options.col !== undefined ? Math.min(options.col - 1, line.length) : 0
      offset = line.from + col
    }
    if (offset !== undefined) {
      const clamped = Math.min(offset, view.state.doc.length)
      view.dispatch({
        selection: { anchor: clamped },
        effects: EditorView.scrollIntoView(clamped, { y: 'center' })
      })
    }
    if (options.scrollTop !== undefined) {
      view.scrollDOM.scrollTop = options.scrollTop
    }
    view.focus()
  },

  jumpBack: async () => {
    const loc = currentLocation()
    if (!loc) return
    const target = jumpHistory.back(loc)
    if (!target) return
    await get().openFile(target.path, { intent: false })
    const view = activeView()
    if (view) {
      const offset = Math.min(target.cursorOffset, view.state.doc.length)
      view.dispatch({ selection: { anchor: offset } })
      view.scrollDOM.scrollTop = target.scrollTop
      view.focus()
    }
  },

  jumpForward: async () => {
    const target = jumpHistory.forward()
    if (!target) return
    await get().openFile(target.path, { intent: false })
    const view = activeView()
    if (view) {
      const offset = Math.min(target.cursorOffset, view.state.doc.length)
      view.dispatch({ selection: { anchor: offset } })
      view.scrollDOM.scrollTop = target.scrollTop
      view.focus()
    }
  },

  setModal: (modal) => set({ openModal: modal }),

  setPanels: (update) => {
    set({ panels: { ...get().panels, ...update } })
    schedulePersist()
  },

  setCursor: (cursor) => set({ cursor })
}))

/** The currently mounted EditorView, registered by EditorPane. */
let currentView: import('@codemirror/view').EditorView | null = null
export function registerActiveView(view: import('@codemirror/view').EditorView | null): void {
  currentView = view
}
export function activeView(): import('@codemirror/view').EditorView | null {
  return currentView
}

export function activeTabPath(): string | null {
  const { tabs } = useWorkspaceStore.getState()
  return tabs.tabs[tabs.activeIndex]?.path ?? null
}
