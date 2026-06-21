import type { ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { rgPath as packedRgPath } from '@vscode/ripgrep'
import type { SearchMatch, SearchOptions, SearchProgress } from '../shared/types'
import { trackedSpawn } from './procRegistry'

/**
 * In a packaged build `@vscode/ripgrep` resolves the binary to a path inside
 * `app.asar`, but electron-builder unpacks it to `app.asar.unpacked`. Electron
 * redirects `fs`/`execFile` to the unpacked copy transparently, but NOT
 * `child_process.spawn` (which is what we use) — spawning the in-asar path
 * throws ENOTDIR, so search silently returns nothing. Rewrite to the unpacked
 * location; in dev there is no `app.asar` segment so this is a no-op.
 */
const rgPath = packedRgPath.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')

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

/** ripgrep's `-r` always treats `$` as a capture reference; in literal
 * (non-regex) mode the user means a literal `$`, which rg escapes as `$$`. */
export function escapeReplacement(replacement: string, regex: boolean): string {
  return regex ? replacement : replacement.replace(/\$/g, '$$$$')
}

export function buildRgArgs(options: SearchOptions, replacement?: string): string[] {
  const args = ['--json', '--line-number', '--no-heading', '--hidden', '--glob', '!.git/**']
  // `-r` makes ripgrep compute each replacement with the same engine that
  // matched, so it stays consistent with the search (captures included)
  if (replacement !== undefined) {
    args.push('-r', escapeReplacement(replacement, options.regex))
  }
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
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
    { kind: 'search', label: `ripgrep: ${options.pattern.slice(0, 40)}` }
  )

  let buffer = ''
  let stderr = ''
  let error: string | null = null
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
      onProgress({ matches: pending, done: isDone, total, capped, error: error ?? undefined })
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

  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })

  // rg exit codes: 0 = matches, 1 = no matches, 2 = error (e.g. bad regex).
  // Without this an invalid pattern is indistinguishable from "no results".
  child.on('close', (code) => {
    if (!capped && code !== null && code !== 0 && code !== 1) {
      error = stderr.trim() || `ripgrep exited with code ${code}`
    }
    finish()
  })
  child.on('error', (err) => {
    error = String(err)
    finish()
  })

  return {
    // Discard, don't flush: a cancelled search's pending matches would land
    // after the renderer reset its results (new search, same id) and show
    // up as stale/duplicate rows
    cancel: () => {
      child.kill()
      if (finished) return
      finished = true
      clearInterval(interval)
      pending = []
      resolveDone()
    },
    done
  }
}

interface ReplaceSpan {
  /** absolute byte offset of the matched range within the file */
  pos: number
  /** byte length of the matched range */
  length: number
  /** ripgrep-computed replacement text (capture refs already expanded) */
  text: string
}

/**
 * Collect, per file, the exact byte ranges to rewrite and the replacement
 * ripgrep computed for each. Using ripgrep's own `-r` engine keeps the match
 * set and capture-group expansion identical to the search — re-deriving them
 * with a JS RegExp would diverge from Rust regex (and could throw on patterns
 * valid only in ripgrep). Offsets are absolute bytes, so multi-byte UTF-8 is
 * handled correctly.
 */
function collectReplaceSpans(
  root: string,
  options: SearchOptions,
  replacement: string
): Promise<{ byFile: Map<string, ReplaceSpan[]>; error: string | null }> {
  return new Promise((resolve) => {
    const child = trackedSpawn(
      rgPath,
      buildRgArgs(options, replacement),
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
      { kind: 'search', label: `ripgrep replace: ${options.pattern.slice(0, 40)}` }
    )
    const byFile = new Map<string, ReplaceSpan[]>()
    let buffer = ''
    let stderr = ''

    const handleLine = (line: string): void => {
      if (!line) return
      let event: {
        type: string
        data?: {
          path?: { text?: string }
          absolute_offset?: number
          submatches?: { start: number; end: number; replacement?: { text?: string } }[]
        }
      }
      try {
        event = JSON.parse(line)
      } catch {
        return
      }
      if (event.type !== 'match' || !event.data) return
      const path = event.data.path?.text
      const base = event.data.absolute_offset
      if (!path || base === undefined) return
      const rel = path.replace(/^\.\//, '')
      const spans = byFile.get(rel) ?? []
      for (const sub of event.data.submatches ?? []) {
        spans.push({
          pos: base + sub.start,
          length: sub.end - sub.start,
          text: sub.replacement?.text ?? ''
        })
      }
      byFile.set(rel, spans)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) handleLine(line)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    const finish = (code: number | null, spawnError?: string): void => {
      if (buffer) handleLine(buffer)
      const error = spawnError
        ? spawnError
        : code !== null && code !== 0 && code !== 1
          ? stderr.trim() || `ripgrep exited with code ${code}`
          : null
      resolve({ byFile, error })
    }
    child.on('close', (code) => finish(code))
    child.on('error', (err) => finish(null, String(err)))
  })
}

/**
 * Global replace-all (spec 03): ripgrep computes the matches and replacements
 * (same engine as the search), then each file is rewritten by byte-splicing
 * those ranges. Open buffers pick the change up through the file watcher
 * (external-changes-win).
 */
export async function replaceAll(
  root: string,
  options: SearchOptions,
  replacement: string,
  onProgress?: (done: number, totalFiles: number, replaced: number) => void
): Promise<{ filesChanged: number; replacements: number; error?: string }> {
  const { byFile, error } = await collectReplaceSpans(root, options, replacement)
  if (error) return { filesChanged: 0, replacements: 0, error }

  let filesChanged = 0
  let replacements = 0
  let processed = 0
  const totalFiles = byFile.size

  for (const [path, spans] of byFile) {
    const abs = join(root, path)
    let buffer: Buffer
    try {
      buffer = await fs.readFile(abs)
    } catch {
      processed += 1
      onProgress?.(processed, totalFiles, replacements)
      continue
    }
    spans.sort((a, b) => a.pos - b.pos)
    const out: Buffer[] = []
    let cursor = 0
    let fileReplacements = 0
    for (const span of spans) {
      // skip anything that would overlap a prior splice or read past EOF
      // (the file may have changed since ripgrep scanned it)
      if (span.pos < cursor || span.pos + span.length > buffer.length) continue
      out.push(buffer.subarray(cursor, span.pos))
      out.push(Buffer.from(span.text, 'utf8'))
      cursor = span.pos + span.length
      fileReplacements += 1
    }
    if (fileReplacements > 0) {
      out.push(buffer.subarray(cursor))
      await fs.writeFile(abs, Buffer.concat(out))
      filesChanged += 1
      replacements += fileReplacements
    }
    processed += 1
    onProgress?.(processed, totalFiles, replacements)
  }

  return { filesChanged, replacements }
}
