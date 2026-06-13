import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { LspDiagnostic } from '../shared/types'
import { resolveShellEnv } from './lsp/env'
import { trackedExecFile } from './procRegistry'

/**
 * Semgrep integration (spec 12): only active when a semgrep config exists at
 * the workspace root AND the binary is on the resolved PATH. One scan at a
 * time; stale results discarded via per-file generations.
 */

interface SemgrepResult {
  check_id: string
  start: { line: number; col: number }
  end: { line: number; col: number }
  extra: { message: string; severity: string }
}

/** Parse semgrep `--json` output into diagnostics (0-based, severity mapped). */
export function parseSemgrepResults(stdout: string): LspDiagnostic[] {
  const report = JSON.parse(stdout) as { results?: SemgrepResult[] }
  return (report.results ?? []).map((r) => ({
    startLine: r.start.line - 1,
    startChar: r.start.col - 1,
    endLine: r.end.line - 1,
    endChar: r.end.col - 1,
    severity: r.extra.severity === 'ERROR' ? 1 : r.extra.severity === 'WARNING' ? 2 : 3,
    message: `${r.check_id}: ${r.extra.message}`,
    source: 'semgrep'
  }))
}

export class SemgrepRunner {
  private configPath: string | null = null
  private binary: string | null = null
  private checked = false
  private generations = new Map<string, number>()
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private root: string,
    private onDiagnostics: (relPath: string, diagnostics: LspDiagnostic[]) => void,
    /** test seam: env resolution spawns a real login shell otherwise */
    private envFor: (dir: string) => Promise<Record<string, string>> = resolveShellEnv
  ) {}

  private async ensureChecked(): Promise<boolean> {
    if (this.checked) return this.binary !== null && this.configPath !== null
    this.checked = true
    for (const candidate of ['.semgrep.yml', '.semgrep.yaml', '.semgrep']) {
      try {
        await fs.access(join(this.root, candidate))
        this.configPath = join(this.root, candidate)
        break
      } catch {
        // keep looking
      }
    }
    if (!this.configPath) return false
    const env = await this.envFor(this.root)
    for (const dir of (env.PATH ?? '').split(':')) {
      try {
        await fs.access(join(dir, 'semgrep'))
        this.binary = join(dir, 'semgrep')
        break
      } catch {
        // keep looking
      }
    }
    return this.binary !== null
  }

  /** Scan one file (on open and on save). Serialized; stale runs dropped. */
  scan(relPath: string): void {
    const generation = (this.generations.get(relPath) ?? 0) + 1
    this.generations.set(relPath, generation)
    this.queue = this.queue.then(async () => {
      if (this.generations.get(relPath) !== generation) return // superseded
      if (!(await this.ensureChecked())) return

      let stdout: string
      try {
        const result = await trackedExecFile(
          this.binary as string,
          [
            'scan',
            '--config',
            this.configPath as string,
            '--json',
            '--no-git-ignore',
            '--metrics=off',
            '--quiet',
            '--disable-version-check',
            '--timeout',
            '30',
            '--jobs',
            '1',
            relPath
          ],
          { cwd: this.root, maxBuffer: 64 * 1024 * 1024, timeout: 60_000 },
          { kind: 'semgrep', label: `semgrep: ${relPath}` }
        )
        stdout = result.stdout
      } catch (error) {
        // exit code 1 = findings present (execFile throws), and its stdout
        // still holds the JSON report; any other failure has no usable stdout
        const errStdout = (error as { stdout?: string }).stdout
        if (!errStdout) return
        stdout = errStdout
      }

      if (this.generations.get(relPath) !== generation) return
      let diagnostics: LspDiagnostic[]
      try {
        diagnostics = parseSemgrepResults(stdout)
      } catch {
        return // non-JSON output from a broken binary — nothing to report
      }
      this.onDiagnostics(relPath, diagnostics)
    })
  }
}
