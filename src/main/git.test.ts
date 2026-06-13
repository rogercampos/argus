import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { StubBrowserWindow } from '../../test/electronStub'
import type { GitState, GitStatusDiff } from '../shared/types'
import { debounceWait, GitMonitor, parsePorcelain, readBranchAndState } from './git'

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
}

describe('git monitor pieces (spec 09)', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'argus-git-test-'))
    git(root, 'init', '-b', 'main')
    git(root, 'config', 'user.email', 't@example.com')
    git(root, 'config', 'user.name', 'T')
    writeFileSync(join(root, 'a.txt'), 'hello\n')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'init')
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reads the branch from HEAD', async () => {
    const state = await readBranchAndState(root)
    expect(state.branch).toBe('main')
    expect(state.state).toBeNull()
  })

  it('detects merging state via MERGE_HEAD', async () => {
    writeFileSync(join(root, '.git/MERGE_HEAD'), 'deadbeef\n')
    const state = await readBranchAndState(root)
    expect(state.state).toBe('merging')
    rmSync(join(root, '.git/MERGE_HEAD'))
  })

  it('detects rebasing state via rebase-merge dir', async () => {
    mkdirSync(join(root, '.git/rebase-merge'))
    const state = await readBranchAndState(root)
    expect(state.state).toBe('rebasing')
    rmSync(join(root, '.git/rebase-merge'), { recursive: true })
  })

  it('reports null branch for non-repos', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'argus-nongit-'))
    try {
      const state = await readBranchAndState(plain)
      expect(state.branch).toBeNull()
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })

  it('parses porcelain -z output including renames', () => {
    const out = ' M modified.ts\0?? untracked.ts\0A  added.ts\0R  renamed-new.ts\0renamed-old.ts\0'
    const map = parsePorcelain(out)
    expect(map.get('modified.ts')).toBe('modified')
    expect(map.get('untracked.ts')).toBe('untracked')
    expect(map.get('added.ts')).toBe('added')
    expect(map.get('renamed-new.ts')).toBe('renamed')
    expect(map.has('renamed-old.ts')).toBe(false)
  })

  it('parses real porcelain output from a repo', () => {
    writeFileSync(join(root, 'a.txt'), 'changed\n')
    writeFileSync(join(root, 'new.txt'), 'new\n')
    const out = execFileSync(
      'git',
      ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { encoding: 'utf8' }
    )
    const map = parsePorcelain(out)
    expect(map.get('a.txt')).toBe('modified')
    expect(map.get('new.txt')).toBe('untracked')
  })
})

describe('GitMonitor (spec 09)', () => {
  function makeRepo(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'argus-gitmon-')))
    git(root, 'init', '-b', 'main')
    git(root, 'config', 'user.email', 't@example.com')
    git(root, 'config', 'user.name', 'T')
    writeFileSync(join(root, 'tracked.txt'), 'committed\n')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'init')
    return root
  }

  function monitorWindow(): {
    window: BrowserWindow
    stub: StubBrowserWindow
    gitStates: () => GitState[]
    diffs: () => GitStatusDiff[]
  } {
    const stub = new StubBrowserWindow()
    return {
      window: stub as unknown as BrowserWindow,
      stub,
      gitStates: () =>
        stub.webContents.sent
          .filter((m) => m.channel === 'git:state')
          .map((m) => m.args[0] as GitState),
      diffs: () =>
        stub.webContents.sent
          .filter((m) => m.channel === 'git:status-diff')
          .map((m) => m.args[0] as GitStatusDiff)
    }
  }

  it('reports non-repos once and stays quiet', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'argus-gitmon-plain-'))
    const { window, gitStates } = monitorWindow()
    const monitor = new GitMonitor(plain, window)
    try {
      await monitor.start()
      expect(gitStates()).toEqual([{ isRepo: false, branch: null, state: null }])
      monitor.noteChanges(['a.txt']) // ignored outside repos
      expect(monitor.currentStatuses()).toEqual([])
    } finally {
      monitor.dispose()
      rmSync(plain, { recursive: true, force: true })
    }
  })

  it('sends branch state and the initial full status scan', async () => {
    const root = makeRepo()
    writeFileSync(join(root, 'tracked.txt'), 'modified\n')
    writeFileSync(join(root, 'fresh.txt'), 'untracked\n')
    const { window, gitStates, diffs } = monitorWindow()
    const monitor = new GitMonitor(root, window)
    try {
      await monitor.start()
      expect(gitStates()[0]).toEqual({ isRepo: true, branch: 'main', state: null })

      // the initial full rescan is deferred ~300ms after start
      await vi.waitFor(
        () => {
          const all = Object.assign({}, ...diffs())
          expect(all['tracked.txt']).toBe('modified')
          expect(all['fresh.txt']).toBe('untracked')
        },
        { timeout: 5000 }
      )
      expect(monitor.currentStatuses()).toContainEqual({
        path: 'tracked.txt',
        status: 'modified'
      })
    } finally {
      monitor.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('targeted rescans diff against known statuses, null = back to clean', async () => {
    const root = makeRepo()
    writeFileSync(join(root, 'tracked.txt'), 'modified\n')
    const { window, diffs } = monitorWindow()
    const monitor = new GitMonitor(root, window)
    try {
      await monitor.start()
      await vi.waitFor(
        () => expect(Object.assign({}, ...diffs())['tracked.txt']).toBe('modified'),
        { timeout: 5000 }
      )

      // revert to the committed content: the file becomes clean again
      writeFileSync(join(root, 'tracked.txt'), 'committed\n')
      monitor.noteChanges(['tracked.txt'])
      await vi.waitFor(
        () => {
          const last = diffs()[diffs().length - 1]
          expect(last).toEqual({ 'tracked.txt': null })
        },
        { timeout: 5000 }
      )
      expect(monitor.currentStatuses()).toEqual([])
    } finally {
      monitor.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refreshes the branch when .git internals change', async () => {
    const root = makeRepo()
    const { window, gitStates } = monitorWindow()
    const monitor = new GitMonitor(root, window)
    try {
      await monitor.start()
      git(root, 'checkout', '-b', 'feature')
      monitor.noteChanges(['.git/HEAD'])
      await vi.waitFor(
        () => {
          const branches = gitStates().map((s) => s.branch)
          expect(branches).toContain('feature')
        },
        { timeout: 5000 }
      )
    } finally {
      monitor.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('caps the debounce so a continuous event stream cannot starve the flush', () => {
    const t0 = 1_000_000
    // a fresh burst waits the full debounce
    expect(debounceWait(t0, t0)).toBe(500)
    // partway through, the remaining wait shrinks toward the max-wait deadline
    expect(debounceWait(t0, t0 + 1700)).toBe(300)
    // past the 2s cap, flush immediately instead of resetting again
    expect(debounceWait(t0, t0 + 2500)).toBe(0)
  })

  it('parses deleted and ignored porcelain letters', () => {
    const map = parsePorcelain(' D gone.ts\0!! build/out.js\0MM staged-and-dirty.ts\0')
    expect(map.get('gone.ts')).toBe('deleted')
    expect(map.get('build/out.js')).toBe('ignored')
    expect(map.get('staged-and-dirty.ts')).toBe('modified')
  })

  it('detects cherry-pick and revert states', async () => {
    const root = makeRepo()
    try {
      writeFileSync(join(root, '.git/CHERRY_PICK_HEAD'), 'deadbeef\n')
      expect((await readBranchAndState(root)).state).toBe('cherry-picking')
      rmSync(join(root, '.git/CHERRY_PICK_HEAD'))

      writeFileSync(join(root, '.git/REVERT_HEAD'), 'deadbeef\n')
      expect((await readBranchAndState(root)).state).toBe('reverting')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports a short hash for detached HEAD', async () => {
    const root = makeRepo()
    try {
      const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
        encoding: 'utf8'
      }).trim()
      git(root, 'checkout', '--detach', head)
      const state = await readBranchAndState(root)
      expect(state.branch).toBe(head.slice(0, 8))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
