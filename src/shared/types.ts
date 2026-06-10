export interface GitStatusEntry {
  path: string
  status: 'added' | 'deleted' | 'ignored' | 'modified' | 'renamed' | 'untracked'
}

export type FileReadResult =
  | { ok: true; content: string }
  | { ok: false; reason: 'binary' | 'too-large' | 'error'; message?: string }

export type FileWriteResult = { ok: true } | { ok: false; message: string }

export interface ArgusApi {
  /** Folder to open automatically on startup (dev convenience, set via ARGUS_OPEN). */
  initialFolder: string | null
  openFolder(): Promise<string | null>
  listFiles(root: string): Promise<string[]>
  gitStatus(root: string): Promise<GitStatusEntry[]>
  readFile(root: string, relPath: string): Promise<FileReadResult>
  writeFile(root: string, relPath: string, content: string): Promise<FileWriteResult>
}
