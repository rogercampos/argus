import { describe, expect, it } from 'vitest'
import { globMatches, globToRegExp } from './watchGlob'

describe('globToRegExp', () => {
  it('matches `**/` across any number of segments and `*` within one', () => {
    const re = globToRegExp('**/*.rb')
    expect(re.test('foo.rb')).toBe(true)
    expect(re.test('lib/foo.rb')).toBe(true)
    expect(re.test('a/b/c/foo.rb')).toBe(true)
    // wrong extension / different suffix must not match
    expect(re.test('foo.rbi')).toBe(false)
    expect(re.test('foo.ts')).toBe(false)
  })

  it('keeps a single `*` from crossing directory separators', () => {
    const re = globToRegExp('*.ts')
    expect(re.test('a.ts')).toBe(true)
    expect(re.test('sub/a.ts')).toBe(false)
  })

  it('expands `{a,b}` alternation', () => {
    const re = globToRegExp('**/*.{ts,tsx}')
    expect(re.test('src/a.ts')).toBe(true)
    expect(re.test('a.tsx')).toBe(true)
    expect(re.test('a.js')).toBe(false)
  })
})

describe('globMatches', () => {
  const root = '/proj'

  it('resolves bare patterns against the workspace root', () => {
    expect(globMatches('/proj/lib/foo.rb', root, '**/*.rb')).toBe(true)
    expect(globMatches('/proj/src/a.ts', root, '**/*.ts')).toBe(true)
    expect(globMatches('/proj/src/a.ts', root, '**/*.rb')).toBe(false)
  })

  it('never matches a file outside the base', () => {
    expect(globMatches('/elsewhere/foo.rb', root, '**/*.rb')).toBe(false)
  })

  it('resolves a RelativePattern against its baseUri', () => {
    const glob = {
      baseUri: 'file:///proj',
      pattern: '{.rubocop.yml,.rubocop,.rubocop_todo.yml}'
    }
    expect(globMatches('/proj/.rubocop.yml', root, glob)).toBe(true)
    // the pattern has no `**/`, so a nested config does not match
    expect(globMatches('/proj/sub/.rubocop.yml', root, glob)).toBe(false)
    expect(globMatches('/proj/other.yml', root, glob)).toBe(false)
  })
})
