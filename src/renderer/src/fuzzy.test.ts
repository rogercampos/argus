import { describe, expect, it } from 'vitest'
import { fuzzyMatch, rankPaths } from './fuzzy'

describe('fuzzyMatch', () => {
  it('matches subsequences case-insensitively', () => {
    expect(fuzzyMatch('usr', 'app/models/user.rb')).not.toBeNull()
    expect(fuzzyMatch('USR', 'app/models/user.rb')).not.toBeNull()
    expect(fuzzyMatch('xyz', 'app/models/user.rb')).toBeNull()
  })

  it('returns matched indices for highlighting', () => {
    const m = fuzzyMatch('usr', 'user.rb')
    expect(m?.indices).toEqual([0, 1, 3])
  })

  it('scores basename matches above directory matches', () => {
    const inBasename = fuzzyMatch('user', 'app/models/user.rb')
    const inDirs = fuzzyMatch('user', 'user/models/apple.rb')
    if (!inBasename || !inDirs) throw new Error('expected matches')
    expect(inBasename.score).toBeGreaterThan(inDirs.score)
  })

  it('scores consecutive runs above scattered matches', () => {
    const consecutive = fuzzyMatch('abc', 'xx/abc.rb')
    const scattered = fuzzyMatch('abc', 'xx/axbxc.rb')
    if (!consecutive || !scattered) throw new Error('expected matches')
    expect(consecutive.score).toBeGreaterThan(scattered.score)
  })

  it('empty query matches everything with zero score', () => {
    expect(fuzzyMatch('', 'whatever')).toEqual({ score: 0, indices: [] })
  })
})

describe('rankPaths', () => {
  const paths = [
    'app/models/user.rb',
    'app/controllers/users_controller.rb',
    'spec/models/user_spec.rb',
    'README.md'
  ]

  it('finds the model for a directory+file style query', () => {
    const { items } = rankPaths('modusr', paths, [], 10)
    expect(items[0].path).toBe('app/models/user.rb')
  })

  it('ranks basename hits first for a filename query', () => {
    const { items } = rankPaths('user.rb', paths, [], 10)
    expect(items[0].path).toBe('app/models/user.rb')
  })

  it('empty query lists recents first, then the rest alphabetically', () => {
    const { items, total } = rankPaths('', paths, ['README.md'], 10)
    expect(items[0].path).toBe('README.md')
    expect(items.slice(1).map((i) => i.path)).toEqual([
      'app/controllers/users_controller.rb',
      'app/models/user.rb',
      'spec/models/user_spec.rb'
    ])
    expect(total).toBe(4)
  })

  it('respects the limit and reports the total', () => {
    const { items, total } = rankPaths('r', paths, [], 2)
    expect(items).toHaveLength(2)
    expect(total).toBeGreaterThan(2)
  })
})
