import { type Extension, RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate
} from '@codemirror/view'
import { Language, Parser, Query, type Tree, type Node as TsNode } from 'web-tree-sitter'
import coreWasmUrl from 'web-tree-sitter/web-tree-sitter.wasm?url'
import { CAPTURE_CLASSES, RUBY_HIGHLIGHTS_QUERY } from './highlights'
// vendored grammar; rebuild with `pnpm build:grammars`
import rubyWasmUrl from './tree-sitter-ruby.wasm?url'

/**
 * Ruby syntax highlighting via tree-sitter (same approach as sourcedelve).
 *
 * Perf notes (measured on factorial's 896KB schema.rb):
 * - web-tree-sitter's incremental parse with a reused tree is ~8x SLOWER
 *   than a fresh full parse (3.4s vs 0.4s) — so edits trigger a debounced
 *   full reparse instead, with a longer delay for very large files.
 * - decorations are built only for visible ranges, using Point-based query
 *   options (index-based options silently drop captures in 0.29).
 * - web-tree-sitter indexes strings in UTF-16 code units, matching
 *   CodeMirror offsets directly.
 */

const REPARSE_DELAY_MS = 100
const LARGE_FILE_BYTES = 256 * 1024
const LARGE_FILE_REPARSE_DELAY_MS = 1000

interface RubyLanguage {
  captures: (
    node: TsNode,
    range: {
      startPosition: { row: number; column: number }
      endPosition: { row: number; column: number }
    }
  ) => Array<{ name: string; node: TsNode }>
  makeParser: () => Parser
}

let loading: Promise<RubyLanguage> | null = null

function loadRuby(): Promise<RubyLanguage> {
  loading ??= (async () => {
    await Parser.init({
      locateFile: () => coreWasmUrl
    })
    const language = await Language.load(rubyWasmUrl)
    const query = new Query(language, RUBY_HIGHLIGHTS_QUERY)
    return {
      captures: (node, range) => query.captures(node, range),
      makeParser: () => {
        const parser = new Parser()
        parser.setLanguage(language)
        return parser
      }
    }
  })()
  return loading
}

/** Single-line highlighter for search-result rows (lineHighlight.ts). */
export interface RubyLineHighlighter {
  highlightLine: (text: string) => Array<{ from: number; to: number; className: string }>
}

export async function loadRubyLineHighlighter(): Promise<RubyLineHighlighter> {
  const lang = await loadRuby()
  const parser = lang.makeParser()
  return {
    highlightLine: (text) => {
      const tree = parser.parse(text)
      if (!tree) return []
      const captures = lang.captures(tree.rootNode, {
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: text.length }
      })
      const spans: Array<{ from: number; to: number; className: string }> = []
      for (const { name, node } of captures) {
        const cls = CAPTURE_CLASSES[name]
        if (cls) spans.push({ from: node.startIndex, to: node.endIndex, className: cls })
      }
      tree.delete()
      return spans
    }
  }
}

const decorationCache = new Map<string, Decoration>()
function markFor(captureName: string): Decoration | null {
  const cls = CAPTURE_CLASSES[captureName]
  if (!cls) return null
  let mark = decorationCache.get(cls)
  if (!mark) {
    mark = Decoration.mark({ class: cls })
    decorationCache.set(cls, mark)
  }
  return mark
}

function tsPosition(
  doc: { lineAt(pos: number): { number: number; from: number } },
  offset: number
): { row: number; column: number } {
  const line = doc.lineAt(offset)
  return { row: line.number - 1, column: offset - line.from }
}

class RubyHighlightPlugin {
  decorations: DecorationSet = Decoration.none
  private parser: Parser | null = null
  private tree: Tree | null = null
  private lang: RubyLanguage | null = null
  private reparseTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false

  constructor(private view: EditorView) {
    void loadRuby().then((lang) => {
      if (this.destroyed) return
      this.lang = lang
      this.parser = lang.makeParser()
      this.reparse()
      // empty transaction so the view picks up the new decorations
      this.view.dispatch({})
    })
  }

  update(update: ViewUpdate): void {
    if (!this.parser) return
    if (update.docChanged) {
      // full reparse, debounced (see perf notes above)
      if (this.reparseTimer) clearTimeout(this.reparseTimer)
      const delay =
        update.state.doc.length > LARGE_FILE_BYTES ? LARGE_FILE_REPARSE_DELAY_MS : REPARSE_DELAY_MS
      this.reparseTimer = setTimeout(() => {
        if (this.destroyed) return
        this.reparse()
        this.view.dispatch({})
      }, delay)
      // keep stale decorations mapped through the edit meanwhile
      this.decorations = this.decorations.map(update.changes)
    } else if (update.viewportChanged && this.tree) {
      this.decorations = this.build(update.view)
    }
  }

  destroy(): void {
    this.destroyed = true
    if (this.reparseTimer) clearTimeout(this.reparseTimer)
    this.tree?.delete()
    this.parser?.delete()
  }

  private reparse(): void {
    if (!this.parser) return
    this.tree?.delete()
    this.tree = this.parser.parse(this.view.state.doc.toString())
    this.decorations = this.build(this.view)
  }

  private build(view: EditorView): DecorationSet {
    if (!this.tree || !this.lang) return Decoration.none
    const docLength = view.state.doc.length
    const ranges: Array<{ from: number; to: number; mark: Decoration }> = []
    const rootNode = this.tree.rootNode
    if (!rootNode) return Decoration.none
    const doc = view.state.doc
    for (const visible of view.visibleRanges) {
      for (const capture of this.lang.captures(rootNode, {
        startPosition: tsPosition(doc, visible.from),
        endPosition: tsPosition(doc, Math.min(visible.to, docLength))
      })) {
        const mark = markFor(capture.name)
        if (!mark) continue
        const from = capture.node.startIndex
        const to = Math.min(capture.node.endIndex, docLength)
        if (to > from) ranges.push({ from, to, mark })
      }
    }
    ranges.sort((a, b) => a.from - b.from || b.to - a.to)
    const builder = new RangeSetBuilder<Decoration>()
    let lastFrom = -1
    let lastTo = -1
    for (const { from, to, mark } of ranges) {
      if (from === lastFrom && to === lastTo) continue // dedupe overlapping visible ranges
      builder.add(from, to, mark)
      lastFrom = from
      lastTo = to
    }
    return builder.finish()
  }
}

export function rubyHighlight(): Extension {
  return ViewPlugin.fromClass(RubyHighlightPlugin, {
    decorations: (plugin) => plugin.decorations
  })
}
