import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  INDEX,
  loadDiff,
  openPullRequests,
  parseRawNumstat,
  parseUntrackedStatus,
  readDiffSide,
  recentCommits,
  repoRoot,
  WORKTREE
} from './diff'

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { stdio: 'pipe', encoding: 'utf8' }).trim()
}

function commitAll(root: string, message: string): string {
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', message)
  return git(root, 'rev-parse', 'HEAD')
}

describe('diff parsing', () => {
  it('parses combined raw + numstat output, including renames and binaries', () => {
    const out = [
      ':100644 100644 aaa bbb M',
      'src/a.ts',
      ':100644 100644 ccc ddd R087',
      'old.ts',
      'new.ts',
      ':000000 100644 000 eee A',
      'img.png',
      ':100644 000000 fff 000 D',
      'gone.txt',
      ':100644 100644 111 222 C100',
      'a.ts',
      'copy.ts',
      '3\t1\tsrc/a.ts',
      '2\t0\t',
      'old.ts',
      'new.ts',
      '-\t-\timg.png',
      '0\t4\tgone.txt',
      '5\t0\tcopy.ts',
      ''
    ].join('\0')
    expect(parseRawNumstat(out)).toEqual([
      {
        path: 'src/a.ts',
        oldPath: null,
        status: 'modified',
        additions: 3,
        deletions: 1,
        binary: false
      },
      {
        path: 'new.ts',
        oldPath: 'old.ts',
        status: 'renamed',
        additions: 2,
        deletions: 0,
        binary: false
      },
      {
        path: 'img.png',
        oldPath: null,
        status: 'added',
        additions: null,
        deletions: null,
        binary: true
      },
      {
        path: 'gone.txt',
        oldPath: null,
        status: 'deleted',
        additions: 0,
        deletions: 4,
        binary: false
      },
      // copies read as plain additions
      { path: 'copy.ts', oldPath: null, status: 'added', additions: 5, deletions: 0, binary: false }
    ])
  })
})

describe('untracked status parsing', () => {
  it('keeps untracked files and directories, skipping rename sources', () => {
    const out = ['?? new.txt', 'R  moved.txt', 'orig.txt', ' M a.ts', '?? dir/', ''].join('\0')
    expect(parseUntrackedStatus(out)).toEqual(['new.txt', 'dir/'])
  })
})

describe('diff loading against a real repo', () => {
  let root: string
  let first: string
  let second: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'argus-diff-test-')))
    git(root, 'init', '-q', '-b', 'main')
    git(root, 'config', 'user.email', 't@example.com')
    git(root, 'config', 'user.name', 'Tester')
    writeFileSync(join(root, 'a.txt'), 'one\ntwo\nthree\n')
    writeFileSync(join(root, 'keep.txt'), 'stable\n')
    first = commitAll(root, 'initial')
    writeFileSync(join(root, 'a.txt'), 'one\n2\nthree\nfour\n')
    writeFileSync(join(root, 'b.txt'), 'new file\n')
    second = commitAll(root, 'second change')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('finds the repo root from a subdirectory, and null outside a repo', async () => {
    mkdirSync(join(root, 'sub'))
    expect(await repoRoot(join(root, 'sub'))).toBe(root)
    const plain = realpathSync(mkdtempSync(join(tmpdir(), 'argus-nongit-')))
    try {
      expect(await repoRoot(plain)).toBeNull()
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })

  it('diffs a commit against its parent', async () => {
    const { summary, session } = await loadDiff(root, { kind: 'commit', ref: 'HEAD' })
    expect(summary.title).toBe('second change')
    expect(summary.subtitle).toContain('Tester')
    expect(session.base).toBe(first)
    expect(session.head).toBe(second)
    expect(summary.files).toEqual([
      {
        path: 'a.txt',
        oldPath: null,
        status: 'modified',
        additions: 2,
        deletions: 1,
        binary: false
      },
      { path: 'b.txt', oldPath: null, status: 'added', additions: 1, deletions: 0, binary: false }
    ])
  })

  it('diffs the root commit against the empty tree', async () => {
    const { summary } = await loadDiff(root, { kind: 'commit', ref: first })
    expect(summary.baseLabel).toBe('(root)')
    expect(summary.files.map((f) => [f.path, f.status])).toEqual([
      ['a.txt', 'added'],
      ['keep.txt', 'added']
    ])
  })

  it('reads both sides of a listed file, and nothing else', async () => {
    const { session } = await loadDiff(root, { kind: 'commit', ref: 'HEAD' })
    expect(await readDiffSide(session, 'old', 'a.txt')).toEqual({
      kind: 'text',
      text: 'one\ntwo\nthree\n'
    })
    expect(await readDiffSide(session, 'new', 'a.txt')).toEqual({
      kind: 'text',
      text: 'one\n2\nthree\nfour\n'
    })
    // added file: no old side
    expect(await readDiffSide(session, 'old', 'b.txt')).toEqual({ kind: 'absent' })
    // unchanged / unknown paths are not readable through a session
    expect(await readDiffSide(session, 'new', 'keep.txt')).toEqual({ kind: 'absent' })
    expect(await readDiffSide(session, 'new', '../etc/passwd')).toEqual({ kind: 'absent' })
  })

  it('includes staged, unstaged and untracked files in uncommitted changes', async () => {
    writeFileSync(join(root, 'a.txt'), 'changed\n') // unstaged
    writeFileSync(join(root, 'staged.txt'), 'staged\n')
    git(root, 'add', 'staged.txt')
    unlinkSync(join(root, 'keep.txt'))
    writeFileSync(join(root, 'untracked.txt'), 'u1\nu2\n')
    mkdirSync(join(root, 'newdir', 'deep'), { recursive: true })
    writeFileSync(join(root, 'newdir', 'deep', 'x.txt'), 'x\n')
    writeFileSync(join(root, 'newdir', 'ignored.log'), 'noise\n')
    writeFileSync(join(root, '.gitignore'), 'ignored.log\n')
    writeFileSync(join(root, 'ignored.log'), 'noise\n')

    const { summary, session } = await loadDiff(root, { kind: 'uncommitted' })
    expect(summary.title).toBe('Uncommitted changes')
    expect(summary.subtitle).toBe('on main')
    expect(session.head).toBe(WORKTREE)
    expect(summary.files.map((f) => [f.path, f.status, f.additions])).toEqual([
      ['.gitignore', 'added', 1],
      ['a.txt', 'modified', 1],
      ['keep.txt', 'deleted', 0],
      ['newdir/deep/x.txt', 'added', 1],
      ['staged.txt', 'added', 1],
      ['untracked.txt', 'added', 2]
    ])
    expect(await readDiffSide(session, 'new', 'untracked.txt')).toEqual({
      kind: 'text',
      text: 'u1\nu2\n'
    })
    expect(await readDiffSide(session, 'old', 'keep.txt')).toEqual({
      kind: 'text',
      text: 'stable\n'
    })
  })

  it('shows only the index for staged changes', async () => {
    writeFileSync(join(root, 'a.txt'), 'staged version\n')
    git(root, 'add', 'a.txt')
    writeFileSync(join(root, 'a.txt'), 'worktree version\n')
    const { summary, session } = await loadDiff(root, { kind: 'staged' })
    expect(session.head).toBe(INDEX)
    expect(summary.files.map((f) => f.path)).toEqual(['a.txt'])
    expect(await readDiffSide(session, 'new', 'a.txt')).toEqual({
      kind: 'text',
      text: 'staged version\n'
    })
  })

  it('works in a repo with no commits yet', async () => {
    const fresh = realpathSync(mkdtempSync(join(tmpdir(), 'argus-diff-fresh-')))
    try {
      git(fresh, 'init', '-q')
      writeFileSync(join(fresh, 'x.txt'), 'x\n')
      const { summary } = await loadDiff(fresh, { kind: 'uncommitted' })
      expect(summary.files.map((f) => [f.path, f.status])).toEqual([['x.txt', 'added']])
    } finally {
      rmSync(fresh, { recursive: true, force: true })
    }
  })

  it('detects renames and reads the old path on the old side', async () => {
    git(root, 'mv', 'keep.txt', 'moved.txt')
    const third = commitAll(root, 'rename')
    const { summary, session } = await loadDiff(root, { kind: 'commit', ref: third })
    expect(summary.files).toEqual([
      expect.objectContaining({ path: 'moved.txt', oldPath: 'keep.txt', status: 'renamed' })
    ])
    expect(await readDiffSide(session, 'old', 'keep.txt')).toEqual({
      kind: 'text',
      text: 'stable\n'
    })
  })

  it('flags binary files', async () => {
    writeFileSync(join(root, 'img.bin'), Buffer.from([0, 1, 2, 3, 0, 255]))
    commitAll(root, 'binary')
    const { summary, session } = await loadDiff(root, { kind: 'commit', ref: 'HEAD' })
    expect(summary.files).toEqual([
      expect.objectContaining({ path: 'img.bin', binary: true, additions: null })
    ])
    expect(await readDiffSide(session, 'new', 'img.bin')).toEqual({ kind: 'binary' })
  })

  it('diffs a three-dot range from the merge base', async () => {
    git(root, 'checkout', '-q', '-b', 'feature')
    writeFileSync(join(root, 'feature.txt'), 'f\n')
    commitAll(root, 'feature work')
    git(root, 'checkout', '-q', 'main')
    writeFileSync(join(root, 'main-only.txt'), 'm\n')
    commitAll(root, 'main moves on')

    const three = await loadDiff(root, {
      kind: 'range',
      base: 'main',
      head: 'feature',
      mergeBase: true
    })
    expect(three.summary.files.map((f) => f.path)).toEqual(['feature.txt'])
    expect(three.summary.subtitle).toBe('1 commit')
    expect(three.session.base).toBe(second)

    const two = await loadDiff(root, {
      kind: 'range',
      base: 'main',
      head: 'feature',
      mergeBase: false
    })
    expect(two.summary.files.map((f) => [f.path, f.status])).toEqual([
      ['feature.txt', 'added'],
      ['main-only.txt', 'deleted']
    ])
  })

  it('rejects unknown refs and refs that look like options', async () => {
    await expect(loadDiff(root, { kind: 'commit', ref: 'nope' })).rejects.toThrow(
      'Unknown revision: nope'
    )
    await expect(loadDiff(root, { kind: 'commit', ref: '--output=/tmp/x' })).rejects.toThrow(
      'Unknown revision'
    )
  })

  it('lists recent commits newest first', async () => {
    const commits = await recentCommits(root, 10)
    expect(commits.map((c) => c.subject)).toEqual(['second change', 'initial'])
    expect(commits[0]).toEqual(
      expect.objectContaining({ sha: second, author: 'Tester', date: expect.any(Number) })
    )
  })
})

/**
 * Pull requests go through the GitHub CLI, an external service: a fake `gh`
 * (via ARGUS_GH) answers with canned JSON, while git runs for real — including
 * fetching the PR's head from a local "GitHub" remote the clone doesn't have.
 */
describe('pull requests', () => {
  let dir: string
  let local: string
  let base: string
  let head: string
  const previousGh = process.env.ARGUS_GH

  function fakeGh(view: unknown, list: unknown, fail?: string): void {
    writeFileSync(join(dir, 'view.json'), JSON.stringify(view))
    writeFileSync(join(dir, 'list.json'), JSON.stringify(list))
    const script = join(dir, 'gh')
    writeFileSync(
      script,
      fail
        ? `#!/bin/sh\necho "${fail}" >&2\nexit 1\n`
        : `#!/bin/sh\ncase "$1 $2" in\n  "pr view") cat "${dir}/view.json" ;;\n  "pr list") cat "${dir}/list.json" ;;\n  *) exit 1 ;;\nesac\n`
    )
    chmodSync(script, 0o755)
    process.env.ARGUS_GH = script
  }

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'argus-pr-test-')))
    // the "GitHub" side: its path ends in acme/app, matching the PR URL
    const upstream = join(dir, 'acme', 'app')
    mkdirSync(upstream, { recursive: true })
    git(upstream, 'init', '-q', '-b', 'main')
    git(upstream, 'config', 'user.email', 't@example.com')
    git(upstream, 'config', 'user.name', 'Tester')
    writeFileSync(join(upstream, 'a.txt'), 'a\n')
    base = commitAll(upstream, 'base')
    git(upstream, 'checkout', '-q', '-b', 'feature')
    writeFileSync(join(upstream, 'feature.txt'), 'feature\n')
    head = commitAll(upstream, 'feature')
    git(upstream, 'update-ref', 'refs/pull/7/head', head)
    git(upstream, 'checkout', '-q', 'main')
    git(upstream, 'branch', '-q', '-D', 'feature')

    // the local clone knows main only, like a contributor's checkout
    local = join(dir, 'local')
    execFileSync('git', ['clone', '-q', '--single-branch', '--branch', 'main', upstream, local])
  })

  afterAll(() => {
    if (previousGh === undefined) delete process.env.ARGUS_GH
    else process.env.ARGUS_GH = previousGh
    rmSync(dir, { recursive: true, force: true })
  })

  const view = (): Record<string, unknown> => ({
    number: 7,
    title: 'Add feature',
    url: 'https://github.com/acme/app/pull/7',
    author: { login: 'dev' },
    baseRefName: 'main',
    headRefName: 'feature',
    baseRefOid: base,
    headRefOid: head,
    state: 'OPEN'
  })

  it('fetches a PR head the clone lacks and diffs it from the merge base', async () => {
    fakeGh(view(), [])
    const { summary, session } = await loadDiff(local, { kind: 'pr', ref: '7' })
    expect(summary.title).toBe('#7 Add feature')
    expect(summary.subtitle).toBe('dev')
    expect(summary.url).toBe('https://github.com/acme/app/pull/7')
    expect([summary.baseLabel, summary.headLabel]).toEqual(['main', 'feature'])
    expect(summary.files.map((f) => [f.path, f.status])).toEqual([['feature.txt', 'added']])
    expect(session).toEqual(expect.objectContaining({ base, head }))
    expect(await readDiffSide(session, 'new', 'feature.txt')).toEqual({
      kind: 'text',
      text: 'feature\n'
    })
    // fetched without creating local refs
    expect(git(local, 'for-each-ref', '--format=%(refname)', 'refs/heads')).toBe('refs/heads/main')
  })

  it('notes a closed or merged PR’s state', async () => {
    fakeGh({ ...view(), state: 'MERGED' }, [])
    const { summary } = await loadDiff(local, { kind: 'pr', ref: '7' })
    expect(summary.subtitle).toBe('dev · merged')
  })

  it('surfaces gh’s own error', async () => {
    fakeGh(view(), [], 'no pull requests found for branch x')
    await expect(loadDiff(local, { kind: 'pr', ref: '99' })).rejects.toThrow(
      'no pull requests found for branch x'
    )
  })

  it('explains a missing gh', async () => {
    process.env.ARGUS_GH = join(dir, 'does-not-exist')
    await expect(loadDiff(local, { kind: 'pr', ref: '7' })).rejects.toThrow(
      'GitHub CLI (gh) not found'
    )
    expect(await openPullRequests(local)).toEqual({
      ok: false,
      error: expect.stringContaining('GitHub CLI (gh) not found')
    })
  })

  it('lists open pull requests', async () => {
    fakeGh(view(), [
      { number: 7, title: 'Add feature', author: { login: 'dev' }, headRefName: 'feature' }
    ])
    expect(await openPullRequests(local)).toEqual({
      ok: true,
      prs: [{ number: 7, title: 'Add feature', author: 'dev', headRefName: 'feature' }]
    })
  })
})
