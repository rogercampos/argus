import { describe, expect, it } from 'vitest'
import { lineSpansFor } from './lineHighlight'

describe('search-result line highlighting', () => {
  it('highlights a TypeScript line with the shared tsh classes', () => {
    const text = "const x = 'hello'"
    const spans = lineSpansFor('src/main/index.ts', text)
    expect(spans).not.toBeNull()
    const byClass = new Map(
      (spans ?? []).map((s) => [s.className, text.slice(s.from, s.to)] as const)
    )
    expect(byClass.get('tsh-keyword')).toBe('const')
    expect(byClass.get('tsh-string')).toBe("'hello'")
  })

  it('highlights numbers and comments', () => {
    const text = 'let n = 42 // answer'
    const spans = lineSpansFor('app.js', text) ?? []
    const classes = spans.map((s) => s.className)
    expect(classes).toContain('tsh-number')
    expect(classes).toContain('tsh-comment')
  })

  it('returns empty spans for unsupported file types', () => {
    expect(lineSpansFor('notes.txt', 'plain text here')).toEqual([])
  })

  it('caches results by language and text', () => {
    const a = lineSpansFor('a/file.ts', 'const y = 1')
    const b = lineSpansFor('other/file.ts', 'const y = 1')
    expect(b).toBe(a) // same array instance straight from the cache
  })

  it('spans are sorted, non-overlapping and within bounds', () => {
    const text = 'export function foo(bar: string): number { return bar.length }'
    const spans = lineSpansFor('x.ts', text) ?? []
    let last = 0
    for (const span of spans) {
      expect(span.from).toBeGreaterThanOrEqual(last)
      expect(span.to).toBeGreaterThan(span.from)
      expect(span.to).toBeLessThanOrEqual(text.length)
      last = span.to
    }
  })
})
