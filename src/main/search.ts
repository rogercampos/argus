import type { ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { rgPath } from '@vscode/ripgrep'
import type { SearchMatch, SearchOptions, SearchProgress } from '../shared/types'
import { trackedSpawn } from './procRegistry'

/**
 * Global search backend (spec 03): ripgrep with --json output, streaming
 * batches every 150ms, hard result caps, cancellation by killing the
 * process.
 */

export const BATCH_INTERVAL_MS = 150
const MAX_LINE_DISPLAY = 200
const TRUNCATE_CONTEXT = 100

export interface RunningSearch {
  cancel: () => void
  done: Promise<void>
}

interface RgSubmatch {
  start: number
  end: number
}

/** Truncate long lines to ±100 chars around the first match (spec 03). */
export function truncateLine(
  text: string,
  submatches: RgSubmatch[]
): { text: string; submatches: RgSubmatch[] } {
  if (text.length <= MAX_LINE_DISPLAY) return { text, submatches }
  const first = submatches[0]?.start ?? 0
  const from = Math.max(0, first - TRUNCATE_CONTEXT)
  const to = Math.min(text.length, first + TRUNCATE_CONTEXT)
  const sliced = (from > 0 ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : '')
  const shift = from > 0 ? from - 1 : 0 // account for the leading ellipsis char
  return {
    text: sliced,
    submatches: submatches
      .filter((s) => s.start >= from && s.start < to)
      .map((s) => ({ start: s.start - shift, end: Math.min(s.end - shift, sliced.length) }))
  }
}

export function buildRgArgs(options: SearchOptions): string[] {
  const args = ['--json', '--line-number', '--no-heading', '--hidden', '--glob', '!.git/**']
  if (!options.caseSensitive) args.push('--ignore-case')
  if (options.wholeWord) args.push('--word-regexp')
  if (!options.regex) args.push('--fixed-strings')
  for (const excluded of options.excludedPaths ?? []) {
    args.push('--glob', `!${excluded}/**`)
  }
  args.push('--', options.pattern)
  args.push(options.scopeFolder ? join('.', options.scopeFolder) : '.')
  return args
}

export function runSearch(
  root: string,
  options: SearchOptions,
  onProgress: (progress: SearchProgress) => void
): RunningSearch {
  const maxResults = options.maxResults ?? 1000
  const child: ChildProcess = trackedSpawn(
    rgPath,
    buildRgArgs(options),
    { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] },
    { kind: 'search', label: `ripgrep: ${options.pattern.slice(0, 40)}` }
  )

  let buffer = ''
  let pending: SearchMatch[] = []
  let total = 0
  let capped = false
  let finished = false

  let resolveDone: () => void = () => {}
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })

  const flush = (isDone: boolean): void => {
    if (pending.length > 0 || isDone) {
      onProgress({ matches: pending, done: isDone, total, capped })
      pending = []
    }
  }

  const interval = setInterval(() => flush(false), BATCH_INTERVAL_MS)

  const finish = (): void => {
    if (finished) return
    finished = true
    clearInterval(interval)
    flush(true)
    resolveDone()
  }

  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line) continue
      let event: {
        type: string
        data?: {
          path?: { text?: string }
          line_number?: number
          lines?: { text?: string }
          submatches?: { start: number; end: number }[]
        }
      }
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      if (event.type !== 'match' || !event.data) continue
      const path = event.data.path?.text
      const lineNumber = event.data.line_number
      const rawText = (event.data.lines?.text ?? '').replace(/\n$/, '')
      if (!path || lineNumber === undefined) continue

      const cleanSubmatches = (event.data.submatches ?? []).map((s) => ({
        start: s.start,
        end: s.end
      }))
      const { text, submatches } = truncateLine(rawText, cleanSubmatches)
      pending.push({
        path: path.replace(/^\.\//, ''),
        line: lineNumber,
        text,
        submatches,
        origSubmatches: cleanSubmatches
      })
      total += 1
      if (total >= maxResults) {
        capped = true
        child.kill()
        finish()
        return
      }
    }
  })

  child.on('close', finish)
  child.on('error', finish)

  return {
    cancel: () => {
      child.kill()
      finish()
    },
    done
  }
}

/**
 * Global replace-all (spec 03): collect matches per file with ripgrep, then
 * rewrite each file line-wise. Open buffers pick the change up through the
 * file watcher (external-changes-win).
 */
export async function replaceAll(
  root: string,
  options: SearchOptions,
  replacement: string,
  onProgress?: (done: number, totalFiles: number, replaced: number) => void
): Promise<{ filesChanged: number; replacements: number }> {
  // collect all matches (no cap)
  const byFile = new Map<string, { line: number; submatches: RgSubmatch[] }[]>()
  await new Promise<void>((resolve) => {
    const search = runSearch(
      root,
      { ...options, maxResults: Number.MAX_SAFE_INTEGER },
      (progress) => {
        for (const match of progress.matches) {
          const list = byFile.get(match.path) ?? []
          list.push({ line: match.line, submatches: match.submatches })
          byFile.set(match.path, list)
        }
        if (progress.done) resolve()
      }
    )
    void search.done
  })

  let filesChanged = 0
  let replacements = 0
  let processed = 0
  const flags = options.caseSensitive ? 'g' : 'gi'
  const escaped = options.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const source = options.regex ? options.pattern : options.wholeWord ? `\\b${escaped}\\b` : escaped
  const matcher = new RegExp(source, flags)
  // capture-group references ($1…) only apply in regex mode
  const replaceWith = options.regex ? replacement : (): string => replacement

  for (const [path, fileMatches] of byFile) {
    const abs = join(root, path)
    let content: string
    try {
      content = await fs.readFile(abs, 'utf8')
    } catch {
      continue
    }
    const lines = content.split('\n')
    let changed = false
    const lineNumbers = new Set(fileMatches.map((m) => m.line))
    for (const lineNumber of lineNumbers) {
      const index = lineNumber - 1
      if (index < 0 || index >= lines.length) continue
      const original = lines[index]
      const count = (original.match(matcher) ?? []).length
      if (count === 0) continue
      const updated =
        typeof replaceWith === 'string'
          ? original.replace(matcher, replaceWith)
          : original.replace(matcher, replaceWith)
      if (updated !== original) {
        replacements += count
        lines[index] = updated
        changed = true
      }
    }
    if (changed) {
      await fs.writeFile(abs, lines.join('\n'), 'utf8')
      filesChanged += 1
    }
    processed += 1
    onProgress?.(processed, byFile.size, replacements)
  }

  return { filesChanged, replacements }
}
