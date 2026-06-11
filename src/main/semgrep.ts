import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { LspDiagnostic } from '../shared/types'
import { resolveShellEnv } from './lsp/env'

const execFileAsync = promisify(execFile)

/**
 * Semgrep integration (spec 12): only active when a semgrep config exists at
 * the workspace root AND the binary is on the resolved PATH. One scan at a
 * time; stale results discarded via per-file generations.
 */

export class SemgrepRunner {
  private configPath: string | null = null
  private binary: string | null = null
  private checked = false
  private generations = new Map<string, number>()
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private root: string,
    private onDiagnostics: (relPath: string, diagnostics: LspDiagnostic[]) => void
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
    const env = await resolveShellEnv(this.root)
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
      try {
        const { stdout } = await execFileAsync(
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
          { cwd: this.root, maxBuffer: 64 * 1024 * 1024, timeout: 60_000 }
        )
        if (this.generations.get(relPath) !== generation) return
        const report = JSON.parse(stdout) as {
          results?: Array<{
            check_id: string
            start: { line: number; col: number }
            end: { line: number; col: number }
            extra: { message: string; severity: string }
          }>
        }
        const diagnostics: LspDiagnostic[] = (report.results ?? []).map((r) => ({
          startLine: r.start.line - 1,
          startChar: r.start.col - 1,
          endLine: r.end.line - 1,
          endChar: r.end.col - 1,
          severity: r.extra.severity === 'ERROR' ? 1 : r.extra.severity === 'WARNING' ? 2 : 3,
          message: `${r.check_id}: ${r.extra.message}`,
          source: 'semgrep'
        }))
        this.onDiagnostics(relPath, diagnostics)
      } catch (error) {
        // exit code 1 = findings present (execFile throws); try parsing stdout
        const stdout = (error as { stdout?: string }).stdout
        if (stdout) {
          try {
            JSON.parse(stdout)
            // recurse-free retry of the parse path
            const report = JSON.parse(stdout) as {
              results?: Array<{
                check_id: string
                start: { line: number; col: number }
                end: { line: number; col: number }
                extra: { message: string; severity: string }
              }>
            }
            const diagnostics: LspDiagnostic[] = (report.results ?? []).map((r) => ({
              startLine: r.start.line - 1,
              startChar: r.start.col - 1,
              endLine: r.end.line - 1,
              endChar: r.end.col - 1,
              severity: r.extra.severity === 'ERROR' ? 1 : r.extra.severity === 'WARNING' ? 2 : 3,
              message: `${r.check_id}: ${r.extra.message}`,
              source: 'semgrep'
            }))
            if (this.generations.get(relPath) === generation) {
              this.onDiagnostics(relPath, diagnostics)
            }
          } catch {
            // real error; log once and move on
          }
        }
      }
    })
  }
}
