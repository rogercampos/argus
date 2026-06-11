import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { Language, Parser, Query } from 'web-tree-sitter'
import { CAPTURE_CLASSES, RUBY_HIGHLIGHTS_QUERY } from './highlights'

/**
 * Runs the real vendored tree-sitter-ruby grammar against the highlight
 * query (no mocks) and checks the capture classification.
 */

const SAMPLE = `# a comment
class User < ApplicationRecord
  ATTR = :name

  def full_name(prefix = nil)
    @first ||= "hi #{prefix} \\n"
    return unless valid?
    [1, 2.5, true, nil].compact
  end
end
`

describe('ruby tree-sitter highlighting', () => {
  let captures: Array<{ name: string; text: string }>

  beforeAll(async () => {
    await Parser.init()
    const language = await Language.load(resolve(__dirname, 'tree-sitter-ruby.wasm'))
    const query = new Query(language, RUBY_HIGHLIGHTS_QUERY)
    const parser = new Parser()
    parser.setLanguage(language)
    const tree = parser.parse(SAMPLE)
    if (!tree?.rootNode) throw new Error('parse failed')
    captures = query
      .captures(tree.rootNode)
      .map((c) => ({ name: c.name, text: SAMPLE.slice(c.node.startIndex, c.node.endIndex) }))
  })

  const find = (name: string, text: string): boolean =>
    captures.some((c) => c.name === name && c.text === text)

  it('classifies keywords', () => {
    expect(find('keyword', 'class')).toBe(true)
    expect(find('keyword', 'def')).toBe(true)
    expect(find('keyword', 'end')).toBe(true)
    expect(find('keyword', 'return')).toBe(true)
    expect(find('keyword', 'unless')).toBe(true)
  })

  it('classifies comments, strings and interpolation', () => {
    expect(find('comment', '# a comment')).toBe(true)
    expect(captures.some((c) => c.name === 'string' && c.text.includes('hi '))).toBe(true)
    expect(find('punctuation.special', '#{')).toBe(true)
    expect(find('string.escape', '\\n')).toBe(true)
  })

  it('classifies constants, symbols, ivars, numbers and builtins', () => {
    expect(find('type.definition', 'User')).toBe(true)
    expect(find('type', 'ApplicationRecord')).toBe(true)
    expect(find('type', 'ATTR')).toBe(true)
    expect(find('symbol', ':name')).toBe(true)
    expect(find('property', '@first')).toBe(true)
    expect(find('number', '1')).toBe(true)
    expect(find('number', '2.5')).toBe(true)
    expect(find('constant.builtin', 'true')).toBe(true)
    expect(find('constant.builtin', 'nil')).toBe(true)
  })

  it('classifies method definitions and calls', () => {
    expect(find('function', 'full_name')).toBe(true)
    expect(find('function.call', 'compact')).toBe(true)
  })

  it('every used capture name maps to a CSS class', () => {
    const used = new Set(captures.map((c) => c.name))
    for (const name of used) {
      expect(CAPTURE_CLASSES[name], `capture ${name} has no class`).toBeDefined()
    }
  })
})
