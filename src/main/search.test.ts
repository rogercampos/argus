import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SearchMatch, SearchProgress } from '../shared/types'
import { replaceAll, runSearch, truncateLine } from './search'

function collect(
  root: string,
  options: Parameters<typeof runSearch>[1]
): Promise<{ matches: SearchMatch[]; capped: boolean }> {
  return new Promise((resolve) => {
    const all: SearchMatch[] = []
    let capped = false
    runSearch(root, options, (progress: SearchProgress) => {
      all.push(...progress.matches)
      capped ||= progress.capped
      if (progress.done) resolve({ matches: all, capped })
    })
  })
}

const baseOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false
}

describe('global search backend (spec 03)', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'argus-search-test-'))
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'docs'))
    mkdirSync(join(root, 'vendor'))
    writeFileSync(join(root, 'src/alpha.ts'), 'const needle = 1\nconst other = 2\nNEEDLE again\n')
    writeFileSync(join(root, 'src/beta.ts'), 'no match here\n')
    writeFileSync(join(root, 'docs/notes.md'), 'a needle in the docs\n')
    writeFileSync(join(root, 'vendor/lib.js'), 'vendored needle\n')
    writeFileSync(join(root, '.gitignore'), 'ignored.txt\n')
    writeFileSync(join(root, 'ignored.txt'), 'needle but gitignored\n')
    // ripgrep honors .gitignore only inside real git repositories
    execFileSync('git', ['-C', root, 'init'], { stdio: 'pipe' })
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('finds matches case-insensitively with positions', async () => {
    const { matches } = await collect(root, { ...baseOptions, pattern: 'needle' })
    const paths = matches.map((m) => `${m.path}:${m.line}`).sort()
    expect(paths).toContain('src/alpha.ts:1')
    expect(paths).toContain('src/alpha.ts:3')
    expect(paths).toContain('docs/notes.md:1')
    const first = matches.find((m) => m.path === 'src/alpha.ts' && m.line === 1)
    expect(first?.submatches[0]).toEqual({ start: 6, end: 12 })
  })

  it('respects case sensitivity', async () => {
    const { matches } = await collect(root, {
      ...baseOptions,
      pattern: 'NEEDLE',
      caseSensitive: true
    })
    expect(matches).toHaveLength(1)
    expect(matches[0].line).toBe(3)
  })

  it('respects excluded paths and gitignore', async () => {
    const { matches } = await collect(root, {
      ...baseOptions,
      pattern: 'needle',
      excludedPaths: ['vendor']
    })
    const paths = matches.map((m) => m.path)
    expect(paths).not.toContain('vendor/lib.js')
    expect(paths).not.toContain('ignored.txt')
  })

  it('scopes to a folder', async () => {
    const { matches } = await collect(root, {
      ...baseOptions,
      pattern: 'needle',
      scopeFolder: 'docs'
    })
    expect(matches.map((m) => m.path)).toEqual(['docs/notes.md'])
  })

  it('supports regex with word boundaries', async () => {
    const { matches } = await collect(root, {
      ...baseOptions,
      pattern: 'need.e',
      regex: true,
      scopeFolder: 'src'
    })
    expect(matches.length).toBeGreaterThan(0)
  })

  it('caps results and reports it', async () => {
    const { matches, capped } = await collect(root, {
      ...baseOptions,
      pattern: 'e',
      maxResults: 2
    })
    expect(matches.length).toBeLessThanOrEqual(2)
    expect(capped).toBe(true)
  })

  it('cancel discards pending matches instead of flushing them', async () => {
    const events: SearchProgress[] = []
    const search = runSearch(root, { ...baseOptions, pattern: 'needle' }, (progress) => {
      events.push(progress)
    })
    search.cancel() // before the first 150ms batch flush
    await search.done
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(events.flatMap((e) => e.matches)).toEqual([])
  })

  it('truncates long lines around the match', () => {
    const long = `${'x'.repeat(300)}needle${'y'.repeat(300)}`
    const { text, submatches } = truncateLine(long, [{ start: 300, end: 306 }])
    expect(text.length).toBeLessThan(220)
    expect(text).toContain('needle')
    expect(text.slice(submatches[0].start, submatches[0].end)).toBe('needle')
  })

  it('replace-all rewrites only matching lines and counts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argus-replace-test-'))
    try {
      writeFileSync(join(dir, 'a.txt'), 'foo bar foo\nclean line\nfoo\n')
      writeFileSync(join(dir, 'b.txt'), 'nothing here\n')
      const result = await replaceAll(dir, { ...baseOptions, pattern: 'foo' }, 'qux')
      expect(result.filesChanged).toBe(1)
      expect(result.replacements).toBe(3)
      expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('qux bar qux\nclean line\nqux\n')
      expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('nothing here\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('replace-all supports regex capture groups', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argus-replace-rx-'))
    try {
      writeFileSync(join(dir, 'a.txt'), 'name: alice\nname: bob\n')
      await replaceAll(dir, { ...baseOptions, pattern: 'name: (\\w+)', regex: true }, 'user=$1')
      expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('user=alice\nuser=bob\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('replace-all treats $ literally in non-regex mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argus-replace-lit-'))
    try {
      writeFileSync(join(dir, 'a.txt'), 'set price here\n')
      const result = await replaceAll(dir, { ...baseOptions, pattern: 'price' }, '$1cost')
      expect(result.replacements).toBe(1)
      expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('set $1cost here\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('replace-all splices correctly across multi-byte UTF-8', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argus-replace-utf8-'))
    try {
      // "é" is 2 bytes; the replacement must land on the right byte offset
      writeFileSync(join(dir, 'a.txt'), 'café foo and foo\nplain foo\n')
      const result = await replaceAll(dir, { ...baseOptions, pattern: 'foo' }, 'BAR')
      expect(result.replacements).toBe(3)
      expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('café BAR and BAR\nplain BAR\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('replace-all preserves a missing trailing newline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argus-replace-nonl-'))
    try {
      writeFileSync(join(dir, 'a.txt'), 'foo bar') // no trailing \n
      await replaceAll(dir, { ...baseOptions, pattern: 'foo' }, 'qux')
      expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('qux bar')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('replace-all reports a ripgrep error instead of silently doing nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argus-replace-err-'))
    try {
      writeFileSync(join(dir, 'a.txt'), 'foo\n')
      // an unbalanced group is invalid regex — ripgrep exits with code 2
      const result = await replaceAll(dir, { ...baseOptions, pattern: '(', regex: true }, 'x')
      expect(result.error).toBeTruthy()
      expect(result.filesChanged).toBe(0)
      expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('foo\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('search reports an invalid regex as an error, not "no results"', async () => {
    const error = await new Promise<string | undefined>((resolve) => {
      runSearch(root, { ...baseOptions, pattern: '(', regex: true }, (progress) => {
        if (progress.done) resolve(progress.error)
      })
    })
    expect(error).toBeTruthy()
  })
})
