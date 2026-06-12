import { describe, expect, it } from 'vitest'
import { languageFor, RUBY_FILE } from './languages'

describe('language wiring (spec 13)', () => {
  it('classifies ruby files including bare Gemfile/Rakefile', () => {
    for (const path of [
      'app/models/user.rb',
      'lib/tasks/db.rake',
      'argus.gemspec',
      'config.ru',
      'Gemfile',
      'sub/dir/Rakefile'
    ]) {
      expect(RUBY_FILE.test(path), path).toBe(true)
    }
    expect(RUBY_FILE.test('Gemfile.lock')).toBe(false)
    expect(RUBY_FILE.test('script.py')).toBe(false)
  })

  it('returns an extension set for every supported language', () => {
    const supported = [
      'a.rb',
      'a.js',
      'a.mjs',
      'a.cjs',
      'a.jsx',
      'a.ts',
      'a.tsx',
      'a.css',
      'a.html',
      'a.htm',
      'a.json',
      'a.md',
      'a.markdown',
      'a.py'
    ]
    for (const path of supported) {
      expect(languageFor(path).length, path).toBeGreaterThan(0)
    }
  })

  it('returns no extensions for unknown file types', () => {
    expect(languageFor('binary.exe')).toEqual([])
    expect(languageFor('noextension')).toEqual([])
    expect(languageFor('styles.scss')).toEqual([])
  })
})
