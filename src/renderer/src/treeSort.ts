/**
 * File tree sort (spec 07): @pierre/trees custom comparators receive FULL
 * path entries and sort the flat path list, so the order must keep shared
 * prefixes contiguous (segment-wise comparison, directories before files).
 * Mirrors the library default, adding starred-first at the top level.
 */

export interface TreeSortEntry {
  basename: string
  depth: number
  isDirectory: boolean
  path: string
  segments: readonly string[]
}

// One shared collator: localeCompare with options builds a collator per call,
// which dominates tree preparation on ~100k-path repos (4x slower overall)
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'accent' })

function naturalCompare(a: string, b: string): number {
  const result = collator.compare(a, b)
  if (result !== 0) return result
  return a < b ? -1 : a > b ? 1 : 0
}

function isDirAtDepth(entry: TreeSortEntry, depth: number): boolean {
  return depth < entry.segments.length - 1 || entry.isDirectory
}

/**
 * Sort a raw path list (files, or directories with a trailing slash) into
 * the exact tree display order. The result feeds the library's presorted
 * fast path, which skips per-path parsing and comparator sorting entirely.
 * Runs in a worker (treeSortWorker) so big repos don't block the UI thread.
 */
export function sortPathsForTree(paths: readonly string[], starred: ReadonlySet<string>): string[] {
  const compare = makeTreeSort(() => starred)
  const entries = paths.map((path) => {
    const isDirectory = path.endsWith('/')
    const clean = isDirectory ? path.slice(0, -1) : path
    const segments = clean.split('/')
    return {
      path,
      entry: {
        path: clean,
        segments,
        basename: segments[segments.length - 1],
        depth: segments.length,
        isDirectory
      }
    }
  })
  entries.sort((a, b) => compare(a.entry, b.entry))
  return entries.map((e) => e.path)
}

export function makeTreeSort(
  starred: () => ReadonlySet<string>
): (a: TreeSortEntry, b: TreeSortEntry) => number {
  return (a, b) => {
    const shared = Math.min(a.segments.length, b.segments.length)
    for (let depth = 0; depth < shared; depth++) {
      const aSeg = a.segments[depth]
      const bSeg = b.segments[depth]
      if (aSeg === bSeg) continue
      const aDir = isDirAtDepth(a, depth)
      const bDir = isDirAtDepth(b, depth)
      if (aDir !== bDir) return aDir ? -1 : 1
      if (depth === 0 && aDir && bDir) {
        const aStar = starred().has(aSeg)
        const bStar = starred().has(bSeg)
        if (aStar !== bStar) return aStar ? -1 : 1
      }
      return naturalCompare(aSeg, bSeg)
    }
    if (a.segments.length !== b.segments.length) {
      return a.segments.length < b.segments.length ? -1 : 1
    }
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return 0
  }
}
