import { execFile } from 'node:child_process'
import { type Dirent, promises as fs } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { FileReadResult, FileWriteResult, GitStatusEntry } from '../shared/types'

const execFileAsync = promisify(execFile)

// git ls-files on a ~100k file repo can return tens of MB
const GIT_MAX_BUFFER = 512 * 1024 * 1024
const MAX_FILE_SIZE = 5 * 1024 * 1024

const WALK_IGNORED = new Set(['.git', 'node_modules'])

/** Resolve a repo-relative path, refusing anything that escapes the root. */
function safeResolve(root: string, relPath: string): string {
  const abs = resolve(root, relPath)
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`Path escapes repository root: ${relPath}`)
  }
  return abs
}

/**
 * List all files under root as relative paths. Uses git when available
 * (tracked + untracked, respecting .gitignore), falling back to a manual
 * walk that prunes node_modules and .git.
 */
export async function listFiles(root: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { maxBuffer: GIT_MAX_BUFFER }
    )
    return stdout.split('\0').filter(Boolean)
  } catch {
    return walkDirectory(root)
  }
}

async function walkDirectory(root: string): Promise<string[]> {
  const results: string[] = []
  const pending: string[] = ['']
  while (pending.length > 0) {
    const dir = pending.pop() as string
    let entries: Dirent[]
    try {
      entries = await fs.readdir(join(root, dir), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (WALK_IGNORED.has(entry.name)) continue
      const relPath = dir === '' ? entry.name : `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        pending.push(relPath)
      } else if (entry.isFile()) {
        results.push(relPath)
      }
    }
  }
  return results
}

const GIT_STATUS_BY_CODE: Record<string, GitStatusEntry['status']> = {
  '?': 'untracked',
  '!': 'ignored',
  A: 'added',
  M: 'modified',
  T: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'added'
}

/** Parse `git status --porcelain -z` into entries keyed by relative path. */
export async function gitStatus(root: string): Promise<GitStatusEntry[]> {
  let stdout: string
  try {
    const result = await execFileAsync(
      'git',
      ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { maxBuffer: GIT_MAX_BUFFER }
    )
    stdout = result.stdout
  } catch {
    return []
  }

  const entries: GitStatusEntry[] = []
  const tokens = stdout.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.length < 4) continue
    const x = token[0]
    const y = token[1]
    const path = token.slice(3)
    // Rename entries are followed by the original path as a separate token
    if (x === 'R' || x === 'C') i++
    const status = GIT_STATUS_BY_CODE[x === ' ' || x === '?' || x === '!' ? y : x]
    if (status) entries.push({ path, status })
  }
  return entries
}

export async function readFile(root: string, relPath: string): Promise<FileReadResult> {
  try {
    const abs = safeResolve(root, relPath)
    const stat = await fs.stat(abs)
    if (stat.size > MAX_FILE_SIZE) {
      return { ok: false, reason: 'too-large' }
    }
    const buffer = await fs.readFile(abs)
    if (buffer.subarray(0, 8000).includes(0)) {
      return { ok: false, reason: 'binary' }
    }
    return { ok: true, content: buffer.toString('utf8') }
  } catch (error) {
    return { ok: false, reason: 'error', message: String(error) }
  }
}

export async function writeFile(
  root: string,
  relPath: string,
  content: string
): Promise<FileWriteResult> {
  try {
    const abs = safeResolve(root, relPath)
    await fs.writeFile(abs, content, 'utf8')
    return { ok: true }
  } catch (error) {
    return { ok: false, message: String(error) }
  }
}
