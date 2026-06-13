import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { LspDiagnostic } from '../shared/types'
import { parseSemgrepResults, SemgrepRunner } from './semgrep'

/**
 * The semgrep binary is faked with a shell script (external dependency);
 * SemgrepRunner itself runs for real, spawning the script.
 */

const REPORT = JSON.stringify({
  results: [
    {
      check_id: 'test.rule-id',
      start: { line: 3, col: 5 },
      end: { line: 3, col: 12 },
      extra: { message: 'do not do this', severity: 'ERROR' }
    },
    {
      check_id: 'test.warn-rule',
      start: { line: 10, col: 1 },
      end: { line: 10, col: 2 },
      extra: { message: 'questionable', severity: 'WARNING' }
    }
  ]
})

function makeRoot(withConfig: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'argus-semgrep-'))
  if (withConfig) writeFileSync(join(root, '.semgrep.yml'), 'rules: []\n')
  writeFileSync(join(root, 'code.rb'), 'puts 1\n')
  return root
}

function makeFakeBinary(script: string): string {
  const binDir = mkdtempSync(join(tmpdir(), 'argus-semgrep-bin-'))
  const bin = join(binDir, 'semgrep')
  writeFileSync(bin, `#!/bin/sh\n${script}\n`)
  chmodSync(bin, 0o755)
  return binDir
}

function runner(
  root: string,
  binDir: string
): { runner: SemgrepRunner; results: Array<{ relPath: string; diagnostics: LspDiagnostic[] }> } {
  const results: Array<{ relPath: string; diagnostics: LspDiagnostic[] }> = []
  return {
    runner: new SemgrepRunner(
      root,
      (relPath, diagnostics) => results.push({ relPath, diagnostics }),
      async () => ({ PATH: binDir })
    ),
    results
  }
}

describe('parseSemgrepResults', () => {
  it('maps results to 0-based diagnostics with severity', () => {
    const diags = parseSemgrepResults(REPORT)
    expect(diags).toHaveLength(2)
    expect(diags[0]).toEqual({
      startLine: 2,
      startChar: 4,
      endLine: 2,
      endChar: 11,
      severity: 1,
      message: 'test.rule-id: do not do this',
      source: 'semgrep'
    })
    expect(diags[1].severity).toBe(2)
  })

  it('returns [] when there are no results', () => {
    expect(parseSemgrepResults('{}')).toEqual([])
  })

  it('throws on non-JSON (callers treat that as a real error)', () => {
    expect(() => parseSemgrepResults('not json')).toThrow()
  })
})

describe('semgrep integration (spec 12)', () => {
  const cleanups: string[] = []
  afterAll(() => {
    for (const dir of cleanups) rmSync(dir, { recursive: true, force: true })
  })

  it('parses findings into diagnostics (0-based, severity mapped)', async () => {
    const root = makeRoot(true)
    const binDir = makeFakeBinary(`echo '${REPORT}'`)
    cleanups.push(root, binDir)
    const { runner: r, results } = runner(root, binDir)

    r.scan('code.rb')
    await vi.waitFor(() => expect(results).toHaveLength(1), { timeout: 5000 })
    expect(results[0].relPath).toBe('code.rb')
    expect(results[0].diagnostics[0]).toEqual({
      startLine: 2,
      startChar: 4,
      endLine: 2,
      endChar: 11,
      severity: 1,
      message: 'test.rule-id: do not do this',
      source: 'semgrep'
    })
    expect(results[0].diagnostics[1].severity).toBe(2)
  })

  it('handles exit code 1 (findings present) by parsing stdout anyway', async () => {
    const root = makeRoot(true)
    const binDir = makeFakeBinary(`echo '${REPORT}'\nexit 1`)
    cleanups.push(root, binDir)
    const { runner: r, results } = runner(root, binDir)

    r.scan('code.rb')
    await vi.waitFor(() => expect(results).toHaveLength(1), { timeout: 5000 })
    expect(results[0].diagnostics).toHaveLength(2)
  })

  it('does nothing without a semgrep config at the root', async () => {
    const root = makeRoot(false)
    const binDir = makeFakeBinary(`echo '${REPORT}'`)
    cleanups.push(root, binDir)
    const { runner: r, results } = runner(root, binDir)

    r.scan('code.rb')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(results).toEqual([])
  })

  it('does nothing when the binary is not on PATH', async () => {
    const root = makeRoot(true)
    const emptyBin = mkdtempSync(join(tmpdir(), 'argus-semgrep-empty-'))
    cleanups.push(root, emptyBin)
    const { runner: r, results } = runner(root, emptyBin)

    r.scan('code.rb')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(results).toEqual([])
  })

  it('drops superseded scans of the same file', async () => {
    const root = makeRoot(true)
    const binDir = makeFakeBinary(`sleep 0.1\necho '${REPORT}'`)
    cleanups.push(root, binDir)
    const { runner: r, results } = runner(root, binDir)

    r.scan('code.rb')
    r.scan('code.rb') // supersedes the first before it runs
    await vi.waitFor(() => expect(results).toHaveLength(1), { timeout: 5000 })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(results).toHaveLength(1)
  })

  it('swallows non-JSON output from a broken binary', async () => {
    const root = makeRoot(true)
    const binDir = makeFakeBinary('echo "catastrophic failure" >&2\nexit 2')
    cleanups.push(root, binDir)
    const { runner: r, results } = runner(root, binDir)

    r.scan('code.rb')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(results).toEqual([])
  })
})
