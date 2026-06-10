import { create } from 'zustand'
import type { GitStatusEntry, PanelLayoutState, PersistedWorkspaceState } from '../../shared/types'
import { defaultWorkspaceState } from '../../shared/types'

interface OpenedFile {
  path: string
  content: string
}

interface WorkspaceStore {
  rootPath: string | null
  rootName: string | null
  paths: string[]
  filePaths: Set<string>
  gitStatus: GitStatusEntry[]
  loadingTree: boolean
  openedFile: OpenedFile | null
  fileError: string | null
  panels: PanelLayoutState
  cursor: { line: number; col: number } | null
  language: string | null

  init: () => Promise<void>
  openFile: (relPath: string) => Promise<void>
  saveFile: (content: string) => Promise<void>
  setPanels: (update: Partial<PanelLayoutState>) => void
  setCursor: (cursor: { line: number; col: number } | null) => void
}

let persisted: PersistedWorkspaceState = defaultWorkspaceState()
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** Debounced (~2s) persistence of workspace layout state (spec 15). */
function schedulePersist(store: () => WorkspaceStore): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const s = store()
    persisted = { ...persisted, panels: s.panels }
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

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  rootPath: null,
  rootName: null,
  paths: [],
  filePaths: new Set(),
  gitStatus: [],
  loadingTree: false,
  openedFile: null,
  fileError: null,
  panels: defaultWorkspaceState().panels,
  cursor: null,
  language: null,

  init: async () => {
    const root = window.api.windowInit.workspacePath
    if (!root) return
    const rootName = root.split('/').filter(Boolean).pop() ?? root
    set({ rootPath: root, rootName, loadingTree: true })

    const stored = await window.api.loadWorkspaceState()
    if (stored) {
      persisted = stored
      set({ panels: stored.panels })
    }

    const [paths, gitStatus] = await Promise.all([
      window.api.listFiles(root),
      window.api.gitStatus(root)
    ])
    set({ paths, filePaths: new Set(paths), gitStatus, loadingTree: false })
  },

  openFile: async (relPath) => {
    const { rootPath } = get()
    if (!rootPath) return
    const result = await window.api.readFile(rootPath, relPath)
    if (result.ok) {
      set({
        openedFile: { path: relPath, content: result.content },
        fileError: null,
        language: languageForPath(relPath)
      })
    } else {
      const message =
        result.reason === 'binary'
          ? 'Binary file — cannot display'
          : result.reason === 'too-large'
            ? 'File is too large to open'
            : (result.message ?? 'Failed to read file')
      set({ openedFile: null, fileError: `${relPath}: ${message}` })
    }
  },

  saveFile: async (content) => {
    const { rootPath, openedFile } = get()
    if (!rootPath || !openedFile) return
    const result = await window.api.writeFile(rootPath, openedFile.path, content)
    if (!result.ok) {
      set({ fileError: `Failed to save ${openedFile.path}: ${result.message}` })
    }
  },

  setPanels: (update) => {
    set({ panels: { ...get().panels, ...update } })
    schedulePersist(get)
  },

  setCursor: (cursor) => set({ cursor })
}))
