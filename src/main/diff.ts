import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type {
  DiffCommitOption,
  DiffFileContent,
  DiffFileEntry,
  DiffFileStatus,
  DiffPrOption,
  DiffSource,
  DiffSummary
} from '../shared/types'
import { BlobReader } from './blobReader'
import { resolveShellEnv } from './lsp/env'
import { trackedExecFile } from './procRegistry'
import { readFile } from './repo'

/**
 * Diff review windows: resolve a DiffSource (uncommitted changes, a commit, a
 * range, a GitHub PR) into a changed-file list plus the two concrete
 * revisions, then serve either side of any listed file on demand. Refs from
 * the user are resolved to SHAs up front (with --end-of-options, so a ref can
 * never be read as a flag); everything after that only ever sees SHAs.
 */

const GIT_MAX_BUFFER = 256 * 1024 * 1024
const MAX_FILE_SIZE = 5 * 1024 * 1024
/** untracked files above this size get no line count (reading them is waste) */
const MAX_COUNTED_UNTRACKED_SIZE = 1024 * 1024
/** how many untracked files are read (for line counts) at once */
const UNTRACKED_READ_CONCURRENCY = 16

/** Pseudo-revisions for the two non-commit sides. */
export const WORKTREE = ':worktree'
export const INDEX = ':index'

export interface DiffSession {
  repoPath: string
  /** a commit/tree SHA */
  base: string
  /** a commit SHA, WORKTREE or INDEX */
  head: string
  /** every path readable on each side, so the renderer can't wander off */
  oldPaths: Set<string>
  newPaths: Set<string>
  /** created on the first committed-side read; see disposeDiffSession */
  blobs?: BlobReader
}

/** Stop the session's background git process (window closed / replaced). */
export function disposeDiffSession(session: DiffSession): void {
  session.blobs?.dispose()
}

async function git(repo: string, args: string[], label: string): Promise<string> {
  const { stdout } = await trackedExecFile(
    'git',
    ['--no-optional-locks', '-C', repo, ...args],
    { maxBuffer: GIT_MAX_BUFFER },
    { kind: 'git', label, selfReportsErrors: true }
  )
  return stdout
}

/** First line of a failed command's stderr, else its message. */
function errorSummary(error: unknown): string {
  const err = error as { stderr?: string; message?: string }
  const stderr = (err.stderr ?? '').trim()
  return (stderr.split('\n')[0] || err.message || String(error)).replace(/^(fatal|error): /, '')
}

/** The repository's top-level directory, or null when `dir` isn't in a git repo. */
export async function repoRoot(dir: string): Promise<string | null> {
  try {
    return (await git(dir, ['rev-parse', '--show-toplevel'], 'git rev-parse')).trim() || null
  } catch {
    return null
  }
}

async function resolveCommit(repo: string, ref: string): Promise<string> {
  try {
    const out = await git(
      repo,
      ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
      'git rev-parse'
    )
    return out.trim()
  } catch {
    throw new Error(`Unknown revision: ${ref}`)
  }
}

async function tryResolveCommit(repo: string, ref: string): Promise<string | null> {
  try {
    return await resolveCommit(repo, ref)
  } catch {
    return null
  }
}

/** The empty tree's id (differs between sha1 and sha256 repos). */
async function emptyTree(repo: string): Promise<string> {
  return (await git(repo, ['hash-object', '-t', 'tree', '/dev/null'], 'git hash-object')).trim()
}

const STATUS_BY_CODE: Record<string, DiffFileStatus> = {
  A: 'added',
  C: 'added',
  D: 'deleted',
  M: 'modified',
  T: 'modified',
  U: 'modified',
  R: 'renamed'
}

/**
 * `git diff --raw --numstat -z` → entries. One git run yields both the
 * statuses (raw records, `:mode mode sha sha STATUS\0path[\0path]`) and the
 * line counts (numstat records, `added\tdeleted\tpath` or, for renames,
 * `added\tdeleted\t\0old\0new`), so rename detection runs only once.
 */
export function parseRawNumstat(stdout: string): DiffFileEntry[] {
  const tokens = stdout.split('\0')
  const byPath = new Map<string, DiffFileEntry>()
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue
    if (token.startsWith(':')) {
      const code = token.slice(token.lastIndexOf(' ') + 1)
      const status = STATUS_BY_CODE[code[0]]
      const twoPaths = code[0] === 'R' || code[0] === 'C'
      const oldPath = twoPaths ? tokens[++i] : null
      const path = tokens[++i]
      if (!status || path === undefined) continue
      byPath.set(path, {
        path,
        oldPath: status === 'renamed' ? oldPath : null,
        status,
        additions: 0,
        deletions: 0,
        binary: false
      })
      continue
    }
    const [added, deleted, inlinePath] = token.split('\t')
    let path = inlinePath
    if (path === '') {
      i++ // old path
      path = tokens[++i]
    }
    const entry = path === undefined ? undefined : byPath.get(path)
    if (!entry) continue
    entry.binary = added === '-'
    entry.additions = entry.binary ? null : Number(added)
    entry.deletions = entry.binary ? null : Number(deleted)
  }
  return [...byPath.values()]
}

/**
 * `git status -z` → untracked paths; untracked directories keep their
 * trailing slash. Rename/copy records carry an extra path token to skip.
 */
export function parseUntrackedStatus(stdout: string): string[] {
  const tokens = stdout.split('\0')
  const paths: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.length < 4) continue
    if (token.startsWith('??')) paths.push(token.slice(3))
    else if (token[0] === 'R' || token[0] === 'C') i++
  }
  return paths
}

/**
 * Untracked file paths. `--untracked-files=all` would walk the whole tree
 * (seconds on a 100k-file repo); `normal` mode is served by git's untracked
 * cache and fsmonitor and reports untracked directories as one entry, so
 * only those few directories get walked, by a targeted ls-files.
 */
async function untrackedPaths(repo: string): Promise<string[]> {
  const status = await git(
    repo,
    ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignore-submodules'],
    'git status (untracked)'
  )
  const entries = parseUntrackedStatus(status)
  const files = entries.filter((p) => !p.endsWith('/'))
  const dirs = entries.filter((p) => p.endsWith('/'))
  if (dirs.length > 0) {
    const inside = await git(
      repo,
      ['ls-files', '--others', '--exclude-standard', '-z', '--', ...dirs],
      'git ls-files (untracked)'
    )
    // nested repositories list as "dir/" — they have no content to diff
    files.push(...inside.split('\0').filter((p) => p && !p.endsWith('/')))
  }
  return files
}

/** Untracked files as added entries, line-counted a few files at a time. */
async function listUntracked(repo: string): Promise<DiffFileEntry[]> {
  const paths = await untrackedPaths(repo)
  const entries: DiffFileEntry[] = new Array(paths.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < paths.length) {
      const index = next++
      entries[index] = await untrackedEntry(repo, paths[index])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(UNTRACKED_READ_CONCURRENCY, paths.length) }, worker)
  )
  return entries
}

/**
 * Changed files between `base` and `head` (a SHA, WORKTREE or INDEX). For the
 * working tree, `untracked` is the (already running) untracked-file listing.
 */
async function changedFiles(
  repo: string,
  base: string,
  head: string,
  untracked: Promise<DiffFileEntry[]>
): Promise<DiffFileEntry[]> {
  const revs = head === WORKTREE ? [base] : head === INDEX ? ['--cached', base] : [base, head]
  const [out, extra] = await Promise.all([
    git(
      repo,
      ['diff', '--no-color', '--no-ext-diff', '-M', '-z', '--raw', '--numstat', ...revs, '--'],
      'git diff'
    ),
    untracked
  ])
  return [...parseRawNumstat(out), ...extra].sort((a, b) => a.path.localeCompare(b.path))
}

async function untrackedEntry(repo: string, path: string): Promise<DiffFileEntry> {
  const entry: DiffFileEntry = {
    path,
    oldPath: null,
    status: 'added',
    additions: null,
    deletions: 0,
    binary: false
  }
  const result = await readFile(repo, path)
  if (result.ok) {
    if (result.content.length <= MAX_COUNTED_UNTRACKED_SIZE) {
      entry.additions = countLines(result.content)
    }
  } else if (result.reason === 'binary') {
    entry.binary = true
    entry.deletions = null
  }
  return entry
}

function countLines(text: string): number {
  if (text === '') return 0
  let lines = 1
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++
  return text.endsWith('\n') ? lines - 1 : lines
}

async function currentBranch(repo: string): Promise<string | null> {
  try {
    return (await git(repo, ['symbolic-ref', '--short', '-q', 'HEAD'], 'git symbolic-ref')).trim()
  } catch {
    return null
  }
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

interface Resolved {
  base: string
  head: string
  title: string
  subtitle: string | null
  url: string | null
  baseLabel: string
  headLabel: string
}

async function resolveSource(repo: string, source: DiffSource): Promise<Resolved> {
  switch (source.kind) {
    case 'uncommitted':
    case 'staged': {
      // a repo with no commits yet diffs against the empty tree
      const head = await tryResolveCommit(repo, 'HEAD')
      const branch = await currentBranch(repo)
      return {
        base: head ?? (await emptyTree(repo)),
        head: source.kind === 'uncommitted' ? WORKTREE : INDEX,
        title: source.kind === 'uncommitted' ? 'Uncommitted changes' : 'Staged changes',
        subtitle: branch ? `on ${branch}` : null,
        url: null,
        baseLabel: 'HEAD',
        headLabel: source.kind === 'uncommitted' ? 'Working tree' : 'Index'
      }
    }
    case 'commit': {
      const sha = await resolveCommit(repo, source.ref)
      const [meta, parent] = await Promise.all([
        git(repo, ['show', '-s', '--format=%h%x00%s%x00%an%x00%at', sha], 'git show'),
        tryResolveCommit(repo, `${sha}^1`)
      ])
      const [short, subject, author, date] = meta.trim().split('\0')
      return {
        base: parent ?? (await emptyTree(repo)),
        head: sha,
        title: subject,
        subtitle: `${short} · ${author} · ${formatDate(Number(date))}`,
        url: null,
        baseLabel: parent ? `${short}^` : '(root)',
        headLabel: short
      }
    }
    case 'range': {
      const [baseSha, headSha] = await Promise.all([
        resolveCommit(repo, source.base),
        resolveCommit(repo, source.head)
      ])
      let base = baseSha
      if (source.mergeBase) {
        try {
          base = (await git(repo, ['merge-base', baseSha, headSha], 'git merge-base')).trim()
        } catch {
          throw new Error(`${source.base} and ${source.head} have no common ancestor`)
        }
      }
      const count = (
        await git(repo, ['rev-list', '--count', `${base}..${headSha}`], 'git rev-list')
      ).trim()
      return {
        base,
        head: headSha,
        title: `${source.base}${source.mergeBase ? '...' : '..'}${source.head}`,
        subtitle: `${count} commit${count === '1' ? '' : 's'}`,
        url: null,
        baseLabel: source.base,
        headLabel: source.head
      }
    }
    case 'pr':
      return resolvePullRequest(repo, source.ref)
  }
}

/** Where gh usually lives (Homebrew on Apple Silicon / Intel, distro packages). */
const GH_LOCATIONS = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']

/**
 * The gh binary and the environment to run it in. GUI-launched apps don't
 * inherit the shell PATH, so a bare `gh` needs the login-shell environment —
 * but resolving that costs a shell startup, so well-known install locations
 * are tried first. ARGUS_GH points at a specific binary (non-standard installs, tests).
 */
async function ghCommand(repo: string): Promise<{ command: string; env: NodeJS.ProcessEnv }> {
  const explicit = process.env.ARGUS_GH ?? GH_LOCATIONS.find((path) => existsSync(path))
  if (explicit) return { command: explicit, env: process.env }
  return { command: 'gh', env: await resolveShellEnv(repo) }
}

async function gh(repo: string, args: string[], label: string): Promise<string> {
  const { command, env } = await ghCommand(repo)
  try {
    const { stdout } = await trackedExecFile(
      command,
      args,
      { cwd: repo, env, maxBuffer: GIT_MAX_BUFFER, timeout: 60_000 },
      { kind: 'git', label, selfReportsErrors: true }
    )
    return stdout
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') {
      throw new Error('GitHub CLI (gh) not found. Install it and run `gh auth login`.')
    }
    throw new Error(errorSummary(error))
  }
}

interface GhPullRequest {
  number: number
  title: string
  url: string
  author: { login: string }
  baseRefName: string
  headRefName: string
  baseRefOid: string
  headRefOid: string
  state: string
}

/**
 * A PR shows what GitHub's "Files changed" tab shows: the head commit against
 * its merge base with the base branch. Missing commits (someone else's
 * branch, a fork) are fetched without creating any local refs.
 */
async function resolvePullRequest(repo: string, ref: string): Promise<Resolved> {
  const pr = JSON.parse(
    await gh(
      repo,
      [
        'pr',
        'view',
        ref,
        '--json',
        'number,title,url,author,baseRefName,headRefName,baseRefOid,headRefOid,state'
      ],
      'gh pr view'
    )
  ) as GhPullRequest

  const missing = async (): Promise<boolean> =>
    !(await tryResolveCommit(repo, pr.baseRefOid)) || !(await tryResolveCommit(repo, pr.headRefOid))
  if (await missing()) {
    const remote = await remoteForUrl(repo, pr.url)
    try {
      await git(
        repo,
        [
          'fetch',
          '--no-tags',
          '--quiet',
          remote,
          `refs/pull/${pr.number}/head`,
          `refs/heads/${pr.baseRefName}`
        ],
        'git fetch (pull request)'
      )
    } catch (error) {
      throw new Error(`Couldn't fetch PR #${pr.number}: ${errorSummary(error)}`)
    }
    if (await missing()) throw new Error(`PR #${pr.number}'s commits aren't available locally`)
  }

  let base: string
  try {
    base = (await git(repo, ['merge-base', pr.baseRefOid, pr.headRefOid], 'git merge-base')).trim()
  } catch {
    base = pr.baseRefOid
  }
  return {
    base,
    head: pr.headRefOid,
    title: `#${pr.number} ${pr.title}`,
    subtitle:
      pr.state === 'OPEN' ? pr.author.login : `${pr.author.login} · ${pr.state.toLowerCase()}`,
    url: pr.url,
    baseLabel: pr.baseRefName,
    headLabel: pr.headRefName
  }
}

/** The remote pointing at the PR's repository, else its clone URL directly. */
async function remoteForUrl(repo: string, prUrl: string): Promise<string> {
  const match = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\//.exec(prUrl)
  if (!match) return 'origin'
  const [, host, owner, name] = match
  const slug = `${owner}/${name}`.toLowerCase()
  try {
    const remotes = await git(repo, ['remote', '-v'], 'git remote')
    for (const line of remotes.split('\n')) {
      const [remoteName, url] = line.split(/\s+/)
      const normalized = (url ?? '').toLowerCase().replace(/\.git$/, '')
      if (normalized.endsWith(`/${slug}`) || normalized.endsWith(`:${slug}`)) return remoteName
    }
  } catch {
    // fall through to the URL
  }
  return `https://${host}/${owner}/${name}.git`
}

export async function loadDiff(
  repoPath: string,
  source: DiffSource
): Promise<{ summary: DiffSummary; session: DiffSession }> {
  let resolved: Resolved
  let files: DiffFileEntry[]
  // the untracked walk is the slow part on big repos and needs no revision,
  // so it starts right away, alongside resolving and diffing
  const untracked = source.kind === 'uncommitted' ? listUntracked(repoPath) : Promise.resolve([])
  untracked.catch(() => {}) // awaited below; don't let an early rejection go unhandled
  try {
    resolved = await resolveSource(repoPath, source)
    files = await changedFiles(repoPath, resolved.base, resolved.head, untracked)
  } catch (error) {
    throw error instanceof Error && !('stderr' in error) ? error : new Error(errorSummary(error))
  }

  const oldPaths = new Set<string>()
  const newPaths = new Set<string>()
  for (const file of files) {
    if (file.status !== 'added') oldPaths.add(file.oldPath ?? file.path)
    if (file.status !== 'deleted') newPaths.add(file.path)
  }
  return {
    summary: {
      repoPath,
      repoName: basename(repoPath),
      title: resolved.title,
      subtitle: resolved.subtitle,
      url: resolved.url,
      baseLabel: resolved.baseLabel,
      headLabel: resolved.headLabel,
      files
    },
    session: { repoPath, base: resolved.base, head: resolved.head, oldPaths, newPaths }
  }
}

/** One side of a listed file: `old` is the base revision, `new` the head. */
export async function readDiffSide(
  session: DiffSession,
  side: 'old' | 'new',
  path: string
): Promise<DiffFileContent> {
  const paths = side === 'old' ? session.oldPaths : session.newPaths
  if (!paths.has(path)) return { kind: 'absent' }
  const rev = side === 'old' ? session.base : session.head

  if (rev === WORKTREE) {
    const result = await readFile(session.repoPath, path)
    if (result.ok) return { kind: 'text', text: result.content }
    if (result.reason === 'binary') return { kind: 'binary' }
    if (result.reason === 'too-large') return { kind: 'too-large' }
    return { kind: 'error', message: result.message ?? 'read failed' }
  }

  const spec = rev === INDEX ? `:${path}` : `${rev}:${path}`
  try {
    session.blobs ??= new BlobReader(session.repoPath, MAX_FILE_SIZE)
    const blob = await session.blobs.read(spec)
    if (blob.kind === 'too-large') return { kind: 'too-large' }
    if (blob.kind === 'missing') return { kind: 'error', message: `${spec} not found` }
    if (blob.data.subarray(0, 8000).includes(0)) return { kind: 'binary' }
    return { kind: 'text', text: blob.data.toString('utf8') }
  } catch (error) {
    return { kind: 'error', message: errorSummary(error) }
  }
}

export async function recentCommits(repo: string, limit: number): Promise<DiffCommitOption[]> {
  try {
    const out = await git(
      repo,
      ['log', `-n${Math.max(1, Math.min(200, limit))}`, '--format=%H%x1f%s%x1f%an%x1f%at%x1e'],
      'git log'
    )
    return out
      .split('\x1e')
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [sha, subject, author, date] = record.split('\x1f')
        return { sha, subject, author, date: Number(date) }
      })
  } catch {
    return [] // no commits yet
  }
}

export async function openPullRequests(
  repo: string
): Promise<{ ok: true; prs: DiffPrOption[] } | { ok: false; error: string }> {
  try {
    const out = await gh(
      repo,
      ['pr', 'list', '--limit', '30', '--json', 'number,title,author,headRefName'],
      'gh pr list'
    )
    const prs = JSON.parse(out) as Array<{
      number: number
      title: string
      author: { login: string }
      headRefName: string
    }>
    return {
      ok: true,
      prs: prs.map((pr) => ({
        number: pr.number,
        title: pr.title,
        author: pr.author.login,
        headRefName: pr.headRefName
      }))
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
