import { describe, expect, it } from 'vitest'
import { formatDiffTarget, parseDiffTarget } from './diffTarget'

describe('parseDiffTarget', () => {
  it.each(['', '  ', '.', 'working', 'Uncommitted'])('%j → uncommitted', (input) => {
    expect(parseDiffTarget(input)).toEqual({ kind: 'uncommitted' })
  })

  it('parses staged', () => {
    expect(parseDiffTarget('staged')).toEqual({ kind: 'staged' })
  })

  it('parses PR numbers and URLs', () => {
    expect(parseDiffTarget('#42')).toEqual({ kind: 'pr', ref: '42' })
    expect(parseDiffTarget('42')).toEqual({ kind: 'pr', ref: '42' })
    const url = 'https://github.com/acme/app/pull/7/files'
    expect(parseDiffTarget(url)).toEqual({ kind: 'pr', ref: url })
  })

  it('parses ranges, defaulting empty sides to HEAD', () => {
    expect(parseDiffTarget('main...feature')).toEqual({
      kind: 'range',
      base: 'main',
      head: 'feature',
      mergeBase: true
    })
    expect(parseDiffTarget('a1b2..c3d4')).toEqual({
      kind: 'range',
      base: 'a1b2',
      head: 'c3d4',
      mergeBase: false
    })
    expect(parseDiffTarget('main...')).toEqual({
      kind: 'range',
      base: 'main',
      head: 'HEAD',
      mergeBase: true
    })
  })

  it('treats anything else as a commit', () => {
    expect(parseDiffTarget('HEAD~2')).toEqual({ kind: 'commit', ref: 'HEAD~2' })
    expect(parseDiffTarget(' a1b2c3d ')).toEqual({ kind: 'commit', ref: 'a1b2c3d' })
  })

  it('round-trips through formatDiffTarget', () => {
    for (const input of ['working', 'staged', '#42', 'main...feature', 'a..b', 'HEAD~1']) {
      expect(formatDiffTarget(parseDiffTarget(input))).toBe(input)
    }
  })
})
