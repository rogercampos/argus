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

function naturalCompare(a: string, b: string): number {
  const result = a.toLowerCase().localeCompare(b.toLowerCase(), undefined, { numeric: true })
  if (result !== 0) return result
  return a < b ? -1 : a > b ? 1 : 0
}

function isDirAtDepth(entry: TreeSortEntry, depth: number): boolean {
  return depth < entry.segments.length - 1 || entry.isDirectory
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
