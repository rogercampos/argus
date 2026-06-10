import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parsePorcelain, readBranchAndState } from './git'

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
