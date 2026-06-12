import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { LanguageSupport } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { tags } from '@lezer/highlight'
import { rubyHighlight } from './ruby/rubyHighlight'

/**
 * Single source of truth for syntax highlighting: per-language wiring and
 * the lezer-tag → tsh-* class rules. The main editor, the search preview,
 * and the search-result line highlighter all derive from here, so adding a
 * language or changing a color applies everywhere at once. The tsh-*
 * classes are styled in main.css (spec 13 palette), shared with the Ruby
 * tree-sitter highlighter.
 */

export const RUBY_FILE = /\.(rb|rake|gemspec|ru)$|(^|\/)(Gemfile|Rakefile)$/

export const SYNTAX_CLASS_RULES = [
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword], class: 'tsh-keyword' },
  { tag: [tags.string, tags.special(tags.string)], class: 'tsh-string' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], class: 'tsh-number' },
  { tag: [tags.typeName, tags.className, tags.namespace], class: 'tsh-type' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    class: 'tsh-function'
  },
  { tag: [tags.comment, tags.blockComment, tags.lineComment], class: 'tsh-comment' },
  { tag: [tags.propertyName, tags.attributeName], class: 'tsh-property' },
  { tag: [tags.operator, tags.punctuation], class: 'tsh-operator' },
  { tag: tags.invalid, class: 'tsh-invalid' }
]

export function languageFor(path: string): Extension[] {
  // Ruby: tree-sitter highlighting, like sourcedelve (LSP semantic tokens off)
  if (RUBY_FILE.test(path)) return [rubyHighlight()]
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return [javascript()]
    case 'jsx':
      return [javascript({ jsx: true })]
    case 'ts':
      return [javascript({ typescript: true })]
    case 'tsx':
      return [javascript({ typescript: true, jsx: true })]
    case 'css':
      return [css()]
    case 'html':
    case 'htm':
      return [html()]
    case 'json':
      return [json()]
    case 'md':
    case 'markdown':
      return [markdown()]
    case 'py':
      return [python()]
    default:
      return []
  }
}

/** @lezer/common Parser, typed via the declared @codemirror/language dep */
export type LezerParser = LanguageSupport['language']['parser']

const parserCache = new Map<string, LezerParser | null>()

/** The lezer parser the editor would use for this path (null: none/ruby). */
export function lezerParserForPath(path: string): LezerParser | null {
  if (RUBY_FILE.test(path)) return null
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const cached = parserCache.get(ext)
  if (cached !== undefined) return cached
  const support = languageFor(path).find((e) => e instanceof LanguageSupport)
  const parser = support instanceof LanguageSupport ? support.language.parser : null
  parserCache.set(ext, parser)
  return parser
}
