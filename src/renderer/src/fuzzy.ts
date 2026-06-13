/**
 * Path-tuned fuzzy matching (spec 04): case-insensitive subsequence match
 * scored with bonuses for basename hits, word boundaries, and consecutive
 * runs. Fast enough to scan ~100k paths per keystroke in a worker.
 */

export interface FuzzyMatch {
  score: number
  /** indices into the target string that matched, for highlighting */
  indices: number[]
}

const BONUS_BOUNDARY = 8
const BONUS_CAMEL = 6
const BONUS_CONSECUTIVE = 4
const BONUS_BASENAME = 6
const GAP_PENALTY = -1
const MAX_GAP_PENALTY = -20

function isBoundaryChar(c: string): boolean {
  return c === '/' || c === '.' || c === '_' || c === '-' || c === ' '
}

export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  if (query.length === 0) return { score: 0, indices: [] }
  if (query.length > target.length) return null

  const q = query.toLowerCase()
  const t = target.toLowerCase()

  // fast subsequence reject
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  if (qi < q.length) return null

  const basenameStart = target.lastIndexOf('/') + 1

  let score = 0
  const indices: number[] = []
  qi = 0
  let lastMatch = -2
  let gapPenalty = 0

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) {
      if (indices.length > 0) gapPenalty = Math.max(gapPenalty + GAP_PENALTY, MAX_GAP_PENALTY)
      continue
    }
    let charScore = 1
    if (ti === 0 || isBoundaryChar(target[ti - 1])) charScore += BONUS_BOUNDARY
    else if (target[ti] >= 'A' && target[ti] <= 'Z' && target[ti - 1] >= 'a') {
      charScore += BONUS_CAMEL
    }
    if (ti === lastMatch + 1) charScore += BONUS_CONSECUTIVE
    if (ti >= basenameStart) charScore += BONUS_BASENAME
    score += charScore
    indices.push(ti)
    lastMatch = ti
    qi++
  }

  return { score: score + gapPenalty, indices }
}

export interface RankedItem {
  path: string
  score: number
  indices: number[]
}

/**
 * Rank `paths` against `query`. Empty query returns recents (in order)
 * followed by the rest alphabetically. Returns at most `limit` items plus
 * the total match count.
 */
export function rankPaths(
  query: string,
  paths: readonly string[],
  recents: readonly string[],
  limit: number
): { items: RankedItem[]; total: number } {
  if (query.length === 0) {
    const recentSet = new Set(recents)
    const pathSet = new Set(paths)
    // Set membership instead of paths.includes() (O(recents × paths) over ~100k)
    const inRepo = recents.filter((p) => pathSet.has(p))
    const rest = paths.filter((p) => !recentSet.has(p)).sort()
    const ordered = [...inRepo, ...rest]
    return {
      items: ordered.slice(0, limit).map((path) => ({ path, score: 0, indices: [] })),
      total: ordered.length
    }
  }

  const matches: RankedItem[] = []
  for (const path of paths) {
    const m = fuzzyMatch(query, path)
    if (m) matches.push({ path, score: m.score, indices: m.indices })
  }
  matches.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1))
  return { items: matches.slice(0, limit), total: matches.length }
}
