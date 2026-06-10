import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gitStatus, listFiles, readFile, writeFile } from './repo'

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
}

describe('repo', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'argus-repo-test-'))
    git(root, 'init')
    git(root, 'config', 'user.email', 'test@example.com')
    git(root, 'config', 'user.name', 'Test')

    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'README.md'), '# Test\n')
    writeFileSync(join(root, 'src/index.ts'), 'export const a = 1\n')
    writeFileSync(join(root, '.gitignore'), 'ignored.log\n')
    writeFileSync(join(root, 'ignored.log'), 'nope\n')
    git(root, 'add', 'README.md', 'src/index.ts', '.gitignore')
    git(root, 'commit', '-m', 'initial')

    // one modified, one untracked
    writeFileSync(join(root, 'src/index.ts'), 'export const a = 2\n')
    writeFileSync(join(root, 'src/new.ts'), 'export const b = 1\n')
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('lists tracked and untracked files, respecting .gitignore', async () => {
    const paths = await listFiles(root)
    expect(paths).toContain('README.md')
    expect(paths).toContain('src/index.ts')
    expect(paths).toContain('src/new.ts')
    expect(paths).not.toContain('ignored.log')
  })

  it('reports git status entries', async () => {
    const entries = await gitStatus(root)
    expect(entries).toContainEqual({ path: 'src/index.ts', status: 'modified' })
    expect(entries).toContainEqual({ path: 'src/new.ts', status: 'untracked' })
  })

  it('reads file contents', async () => {
    const result = await readFile(root, 'README.md')
    expect(result).toEqual({ ok: true, content: '# Test\n' })
  })

  it('rejects binary files', async () => {
    writeFileSync(join(root, 'blob.bin'), Buffer.from([0x89, 0x50, 0x00, 0x47]))
    const result = await readFile(root, 'blob.bin')
    expect(result).toEqual({ ok: false, reason: 'binary' })
  })

  it('refuses paths escaping the root', async () => {
    const result = await readFile(root, '../../etc/hosts')
    expect(result.ok).toBe(false)
  })

  it('writes file contents', async () => {
    const written = await writeFile(root, 'src/new.ts', 'export const b = 2\n')
    expect(written).toEqual({ ok: true })
    const readBack = await readFile(root, 'src/new.ts')
    expect(readBack).toEqual({ ok: true, content: 'export const b = 2\n' })
  })

  it('falls back to walking when the folder is not a git repo', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'argus-plain-test-'))
    try {
      mkdirSync(join(plain, 'node_modules'))
      writeFileSync(join(plain, 'node_modules/skip.js'), 'x')
      writeFileSync(join(plain, 'app.ts'), 'x')
      const paths = await listFiles(plain)
      expect(paths).toEqual(['app.ts'])
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })
})
