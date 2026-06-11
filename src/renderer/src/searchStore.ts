import { create } from 'zustand'
import type { PersistedSearchTab, SearchMatch, SearchOptions } from '../../shared/types'
import { activeView, mergePersisted, useWorkspaceStore } from './store'

/**
 * Global search state (spec 03): one modal surface + N persisted panel tabs,
 * all streaming from the ripgrep backend. Results arrive in batches keyed by
 * searchId.
 */

export const MODAL_SEARCH_ID = 0
export const MODAL_MAX_RESULTS = 100
export const TAB_MAX_RESULTS = 1000

export interface SearchFlags {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

export interface SearchResults {
  matches: SearchMatch[]
  running: boolean
  total: number
  capped: boolean
}

const emptyResults = (): SearchResults => ({
  matches: [],
  running: false,
  total: 0,
  capped: false
})

export interface SearchTab {
  id: number
  pattern: string
  flags: SearchFlags
  scopeFolder: string | null
  results: SearchResults
  /** restored from persistence; search runs on first activation */
  lazy: boolean
  collapsedFiles: string[]
  /** index into results.matches of the selected match */
  selectedMatch: number
}

interface SearchStore {
  flags: SearchFlags
  modalOpen: boolean
  replaceMode: boolean
  modalPattern: string
  modalScope: string | null
  modalResults: SearchResults
  modalSelected: number
  replaceText: string
  lastPattern: string
  tabs: SearchTab[]
  activeTab: number
  /** the pinned Problems tab is selected (spec 12) */
  problemsView: boolean

  init: () => Promise<void>
  showProblems: () => void
  openModal: (replaceMode: boolean) => void
  closeModal: () => void
  setFlags: (update: Partial<SearchFlags>) => void
  setModalScope: (scope: string | null) => void
  runModalSearch: (pattern: string) => void
  openInPanel: () => void
  activateTab: (index: number) => void
  closeTab: (index: number) => void
  closeAllTabs: () => void
  reRunTab: (index: number) => void
  toggleFileCollapsed: (tabIndex: number, path: string) => void
  selectTabMatch: (tabIndex: number, matchIndex: number) => void
  setReplaceText: (text: string) => void
}

let nextTabId = 1

function buildOptions(
  pattern: string,
  flags: SearchFlags,
  scope: string | null,
  maxResults: number
): SearchOptions {
  return {
    pattern,
    caseSensitive: flags.caseSensitive,
    wholeWord: flags.wholeWord,
    regex: flags.regex,
    scopeFolder: scope,
    excludedPaths: useWorkspaceStore.getState().excludedPaths,
    maxResults
  }
}

function persistTabs(): void {
  const s = useSearchStore.getState()
  mergePersisted({
    searchTabs: s.tabs.map((t) => ({
      pattern: t.pattern,
      caseSensitive: t.flags.caseSensitive,
      wholeWord: t.flags.wholeWord,
      regex: t.flags.regex,
      scopeFolder: t.scopeFolder
    })),
    activeSearchTab: s.activeTab,
    searchOptions: s.flags,
    lastSearchPattern: s.lastPattern
  })
}

/** Selection prefill for the modal (spec 03). */
function selectionPrefill(): string | null {
  const view = activeView()
  if (!view) return null
  const { from, to } = view.state.selection.main
  if (from === to) return null
  const text = view.state.sliceDoc(from, to)
  if (text.includes('\n') || text.length > 200) return null
  return text
}

export const useSearchStore = create<SearchStore>((set, get) => ({
  flags: { caseSensitive: false, wholeWord: false, regex: false },
  modalOpen: false,
  replaceMode: false,
  modalPattern: '',
  modalScope: null,
  modalResults: emptyResults(),
  modalSelected: 0,
  replaceText: '',
  lastPattern: '',
  tabs: [],
  activeTab: 0,
  problemsView: true,

  showProblems: () => set({ problemsView: true }),

  init: async () => {
    const stored = await window.api.loadWorkspaceState()
    if (stored?.searchOptions) set({ flags: stored.searchOptions })
    if (stored?.lastSearchPattern) set({ lastPattern: stored.lastSearchPattern })
    if (stored?.searchTabs && stored.searchTabs.length > 0) {
      const tabs: SearchTab[] = stored.searchTabs.map((t: PersistedSearchTab) => ({
        id: nextTabId++,
        pattern: t.pattern,
        flags: { caseSensitive: t.caseSensitive, wholeWord: t.wholeWord, regex: t.regex },
        scopeFolder: t.scopeFolder,
        results: emptyResults(),
        lazy: true,
        collapsedFiles: [],
        selectedMatch: 0
      }))
      const activeTab = Math.min(stored.activeSearchTab ?? 0, tabs.length - 1)
      set({ tabs, activeTab })
      // Only the active tab searches on restore (spec 03 lazy restoration)
      if (useWorkspaceStore.getState().panels.bottomVisible) {
        get().reRunTab(activeTab)
      }
    }

    window.api.onSearchProgress((searchId, progress) => {
      if (searchId === MODAL_SEARCH_ID) {
        const current = get().modalResults
        set({
          modalResults: {
            matches: [...current.matches, ...progress.matches],
            running: !progress.done,
            total: progress.total,
            capped: progress.capped
          }
        })
        return
      }
      const tabs = [...get().tabs]
      const index = tabs.findIndex((t) => t.id === searchId)
      if (index === -1) return
      const tab = tabs[index]
      tabs[index] = {
        ...tab,
        results: {
          matches: [...tab.results.matches, ...progress.matches],
          running: !progress.done,
          total: progress.total,
          capped: progress.capped
        }
      }
      set({ tabs })
    })
  },

  openModal: (replaceMode) => {
    const prefill = selectionPrefill() ?? get().lastPattern
    // Scope: only preset when invoked from the file tree (spec 03); default All
    set({
      modalOpen: true,
      replaceMode,
      modalPattern: prefill,
      modalScope: null,
      modalSelected: 0,
      modalResults: emptyResults()
    })
    if (prefill) get().runModalSearch(prefill)
  },

  closeModal: () => {
    void window.api.cancelSearch(MODAL_SEARCH_ID)
    set({ modalOpen: false, lastPattern: get().modalPattern })
    persistTabs()
  },

  setFlags: (update) => {
    set({ flags: { ...get().flags, ...update } })
    const s = get()
    if (s.modalOpen && s.modalPattern) s.runModalSearch(s.modalPattern)
    persistTabs()
  },

  setModalScope: (scope) => {
    set({ modalScope: scope })
    const s = get()
    if (s.modalPattern) s.runModalSearch(s.modalPattern)
  },

  runModalSearch: (pattern) => {
    set({ modalPattern: pattern, modalResults: { ...emptyResults(), running: true } })
    if (!pattern) {
      void window.api.cancelSearch(MODAL_SEARCH_ID)
      set({ modalResults: emptyResults() })
      return
    }
    void window.api.startSearch(
      MODAL_SEARCH_ID,
      buildOptions(pattern, get().flags, get().modalScope, MODAL_MAX_RESULTS)
    )
  },

  openInPanel: () => {
    const s = get()
    const tab: SearchTab = {
      id: nextTabId++,
      pattern: s.modalPattern,
      flags: { ...s.flags },
      scopeFolder: s.modalScope,
      results: { ...emptyResults(), running: true },
      lazy: false,
      collapsedFiles: [],
      selectedMatch: 0
    }
    set({
      tabs: [...s.tabs, tab],
      activeTab: s.tabs.length,
      modalOpen: false,
      problemsView: false,
      lastPattern: s.modalPattern
    })
    useWorkspaceStore.getState().setPanels({ bottomVisible: true })
    void window.api.startSearch(
      tab.id,
      buildOptions(tab.pattern, tab.flags, tab.scopeFolder, TAB_MAX_RESULTS)
    )
    persistTabs()
  },

  activateTab: (index) => {
    const tab = get().tabs[index]
    if (!tab) return
    set({ activeTab: index, problemsView: false })
    // Re-evaluate on activation so results are always fresh (spec 03)
    get().reRunTab(index)
    persistTabs()
  },

  closeTab: (index) => {
    const tabs = [...get().tabs]
    const [closed] = tabs.splice(index, 1)
    if (closed) void window.api.cancelSearch(closed.id)
    let active = get().activeTab
    if (index < active) active -= 1
    else if (index === active) active = Math.min(active, tabs.length - 1)
    set({ tabs, activeTab: Math.max(0, active), problemsView: tabs.length === 0 })
    persistTabs()
  },

  closeAllTabs: () => {
    for (const tab of get().tabs) void window.api.cancelSearch(tab.id)
    set({ tabs: [], activeTab: 0, problemsView: true })
    persistTabs()
  },

  reRunTab: (index) => {
    const tabs = [...get().tabs]
    const tab = tabs[index]
    if (!tab) return
    tabs[index] = {
      ...tab,
      lazy: false,
      results: { ...emptyResults(), running: true },
      selectedMatch: 0
    }
    set({ tabs })
    void window.api.startSearch(
      tab.id,
      buildOptions(tab.pattern, tab.flags, tab.scopeFolder, TAB_MAX_RESULTS)
    )
  },

  toggleFileCollapsed: (tabIndex, path) => {
    const tabs = [...get().tabs]
    const tab = tabs[tabIndex]
    if (!tab) return
    const collapsed = tab.collapsedFiles.includes(path)
      ? tab.collapsedFiles.filter((p) => p !== path)
      : [...tab.collapsedFiles, path]
    tabs[tabIndex] = { ...tab, collapsedFiles: collapsed }
    set({ tabs })
  },

  selectTabMatch: (tabIndex, matchIndex) => {
    const tabs = [...get().tabs]
    const tab = tabs[tabIndex]
    if (!tab) return
    tabs[tabIndex] = { ...tab, selectedMatch: matchIndex }
    set({ tabs })
  },

  setReplaceText: (text) => set({ replaceText: text })
}))
