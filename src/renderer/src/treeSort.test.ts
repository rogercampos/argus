import { prepareFileTreeInput } from '@pierre/trees'
import { describe, expect, it } from 'vitest'
import { makeTreeSort, sortPathsForTree, type TreeSortEntry } from './treeSort'

function entry(path: string, isDirectory = false): TreeSortEntry {
  const segments = path.split('/')
  return {
    path,
    segments,
    basename: segments[segments.length - 1],
    depth: segments.length,
    isDirectory
  }
}

/** Every directory's contents must stay contiguous in the sorted flat list. */
function prefixesContiguous(paths: string[]): boolean {
  const seen = new Set<string>()
  let previousPrefixes: string[] = []
  for (const path of paths) {
    const segments = path.split('/')
    const prefixes = segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join('/'))
    for (const prefix of prefixes) {
      if (seen.has(prefix) && !previousPrefixes.includes(prefix)) {
        return false // prefix re-appeared after being interrupted
      }
      seen.add(prefix)
    }
    previousPrefixes = prefixes
  }
  return true
}

describe('tree sort comparator (spec 07)', () => {
  const noStars = makeTreeSort(() => new Set())

  it('keeps directory contents contiguous (the duplication bug)', () => {
    const paths = [
      'src/main/index.ts',
      'package.json',
      'src/renderer/src/App.tsx',
      'docs/specs/01.md',
      'README.md',
      'src/main/repo.ts',
      'docs/PHASE_1_GOALS.md',
      'biome.json',
      'src/renderer/src/store.ts',
      '.vscode/settings.json'
    ]
    const sorted = paths
      .map((p) => entry(p))
      .sort(noStars)
      .map((e) => e.path)
    expect(prefixesContiguous(sorted)).toBe(true)
  })

  it('sorts directories before files at every level', () => {
    const sorted = [entry('zz.txt'), entry('aa/file.ts')].sort(noStars).map((e) => e.path)
    expect(sorted).toEqual(['aa/file.ts', 'zz.txt'])
  })

  it('natural-sorts segments case-insensitively', () => {
    const sorted = [entry('file10.ts'), entry('File2.ts'), entry('file1.ts')]
      .sort(noStars)
      .map((e) => e.path)
    expect(sorted).toEqual(['file1.ts', 'File2.ts', 'file10.ts'])
  })

  it('hoists starred top-level folders above everything else', () => {
    const starred = makeTreeSort(() => new Set(['zeta']))
    const sorted = [entry('alpha/a.ts'), entry('zeta/z.ts'), entry('beta/b.ts'), entry('root.txt')]
      .sort(starred)
      .map((e) => e.path)
    expect(sorted).toEqual(['zeta/z.ts', 'alpha/a.ts', 'beta/b.ts', 'root.txt'])
  })

  it('does not hoist starred names below the top level', () => {
    const starred = makeTreeSort(() => new Set(['zeta']))
    const sorted = [entry('app/zeta/z.ts'), entry('app/alpha/a.ts')]
      .sort(starred)
      .map((e) => e.path)
    expect(sorted).toEqual(['app/alpha/a.ts', 'app/zeta/z.ts'])
  })

  it('sortPathsForTree matches the library prepared ordering exactly', () => {
    const paths = [
      'src/main/index.ts',
      'package.json',
      'src/renderer/src/App.tsx',
      'docs/specs/01.md',
      'empty-dir/',
      'README.md',
      'src/main/repo.ts',
      'zeta/z.ts',
      'File2.ts',
      'file10.ts',
      'file1.ts',
      '.vscode/settings.json'
    ]
    const starred = new Set(['zeta'])
    const prepared = prepareFileTreeInput(paths, {
      flattenEmptyDirectories: true,
      sort: makeTreeSort(() => starred)
    })
    expect(sortPathsForTree(paths, starred)).toEqual(prepared.paths)
  })

  it('is consistent on a large shuffled corpus', () => {
    const paths: string[] = []
    for (let d = 0; d < 20; d++) {
      for (let f = 0; f < 20; f++) paths.push(`dir${d}/sub${f % 5}/file${f}.ts`)
    }
    // deterministic shuffle
    const shuffled = [...paths].sort(
      (a, b) => ((a.length * 31 + a.charCodeAt(3)) % 7) - ((b.length * 31 + b.charCodeAt(3)) % 7)
    )
    const sorted = shuffled
      .map((p) => entry(p))
      .sort(noStars)
      .map((e) => e.path)
    expect(prefixesContiguous(sorted)).toBe(true)
    expect(new Set(sorted).size).toBe(new Set(paths).size)
  })
})
