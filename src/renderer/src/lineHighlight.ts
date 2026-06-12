import { highlightTree, tagHighlighter } from '@lezer/highlight'
import { lezerParserForPath, RUBY_FILE, SYNTAX_CLASS_RULES } from './languages'
import type { RubyLineHighlighter } from './ruby/rubyHighlight'

/**
 * Single-line syntax highlighting for search-result rows, built on the SAME
 * machinery as the main editor: the per-language parsers from languages.ts,
 * the shared tag → tsh-* class rules, and the Ruby tree-sitter grammar.
 * Lines are already truncated (~200 chars), so a standalone parse per line
 * costs microseconds; results are cached so re-renders are free. Ruby's
 * wasm grammar loads lazily once; rows re-render via the ready hook.
 */

export interface LineSpan {
  from: number
  to: number
  className: string
}

const lezerClasses = tagHighlighter(SYNTAX_CLASS_RULES)

let rubyHighlighter: RubyLineHighlighter | null = null
let rubyLoadStarted = false
const readyListeners = new Set<() => void>()

/** Notifies when a lazily-loaded grammar (ruby wasm) becomes available. */
export function onLineHighlightReady(listener: () => void): () => void {
  readyListeners.add(listener)
  return () => readyListeners.delete(listener)
}

function ensureRubyLoaded(): void {
  if (rubyLoadStarted) return
  rubyLoadStarted = true
  void import('./ruby/rubyHighlight')
    .then(async (module) => {
      rubyHighlighter = await module.loadRubyLineHighlighter()
      for (const listener of readyListeners) listener()
    })
    .catch(() => {
      // wasm unavailable: ruby rows stay unhighlighted
    })
}

/** Resolve raw (possibly overlapping; later wins) spans into sorted runs. */
function normalizeSpans(
  length: number,
  raw: Array<{ from: number; to: number; className: string }>
): LineSpan[] {
  if (raw.length === 0 || length === 0) return []
  const classAt = new Array<string | null>(length).fill(null)
  for (const span of raw) {
    const from = Math.max(0, span.from)
    const to = Math.min(length, span.to)
    for (let i = from; i < to; i++) classAt[i] = span.className
  }
  const spans: LineSpan[] = []
  let runStart = 0
  for (let i = 1; i <= length; i++) {
    if (i === length || classAt[i] !== classAt[i - 1]) {
      const cls = classAt[i - 1]
      if (cls !== null) spans.push({ from: runStart, to: i, className: cls })
      runStart = i
    }
  }
  return spans
}

const cache = new Map<string, LineSpan[]>()
const MAX_CACHE_ENTRIES = 5000

/**
 * Syntax spans for one result line. Returns null while the language is
 * still loading (subscribe via onLineHighlightReady); [] for plain text.
 */
export function lineSpansFor(path: string, text: string): LineSpan[] | null {
  const isRuby = RUBY_FILE.test(path)
  const langKey = isRuby ? 'ruby' : (path.split('.').pop() ?? '').toLowerCase()
  const key = `${langKey} ${text}`
  const cached = cache.get(key)
  if (cached) return cached

  let raw: Array<{ from: number; to: number; className: string }>
  if (isRuby) {
    if (!rubyHighlighter) {
      ensureRubyLoaded()
      return null
    }
    raw = rubyHighlighter.highlightLine(text)
  } else {
    const parser = lezerParserForPath(path)
    if (!parser) {
      raw = []
    } else {
      const collected: Array<{ from: number; to: number; className: string }> = []
      highlightTree(parser.parse(text), lezerClasses, (from, to, classes) => {
        collected.push({ from, to, className: classes })
      })
      raw = collected
    }
  }

  const spans = normalizeSpans(text.length, raw)
  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear()
  cache.set(key, spans)
  return spans
}
