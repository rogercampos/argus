import { create } from 'zustand'
import type { GitStatusEntry } from '../../shared/types'

interface OpenedFile {
  path: string
  content: string
}

interface RepoState {
  rootPath: string | null
  rootName: string | null
  paths: string[]
  filePaths: Set<string>
  gitStatus: GitStatusEntry[]
  loadingTree: boolean
  openedFile: OpenedFile | null
  fileError: string | null
  loadRoot: (root: string) => Promise<void>
  openFolder: () => Promise<void>
  openFile: (relPath: string) => Promise<void>
  saveFile: (content: string) => Promise<void>
}

export const useRepoStore = create<RepoState>((set, get) => ({
  rootPath: null,
  rootName: null,
  paths: [],
  filePaths: new Set(),
  gitStatus: [],
  loadingTree: false,
  openedFile: null,
  fileError: null,

  loadRoot: async (root) => {
    const rootName = root.split('/').filter(Boolean).pop() ?? root
    set({
      rootPath: root,
      rootName,
      loadingTree: true,
      paths: [],
      gitStatus: [],
      openedFile: null,
      fileError: null
    })
    const [paths, gitStatus] = await Promise.all([
      window.api.listFiles(root),
      window.api.gitStatus(root)
    ])
    set({ paths, filePaths: new Set(paths), gitStatus, loadingTree: false })
  },

  openFolder: async () => {
    const root = await window.api.openFolder()
    if (root) await get().loadRoot(root)
  },

  openFile: async (relPath) => {
    const { rootPath } = get()
    if (!rootPath) return
    const result = await window.api.readFile(rootPath, relPath)
    if (result.ok) {
      set({ openedFile: { path: relPath, content: result.content }, fileError: null })
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
  }
}))
