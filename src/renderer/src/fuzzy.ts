/**
 * Path-tuned fuzzy matching (spec 04): case-insensitive subsequence match
 * scored with bonuses for basename hits, word boundaries, and consecutive
 * runs. Fast enough to scan ~100k paths per keystroke in a worker.
 *
 * `/` and `.` in the query are HARD separators: a query like `models/expense`
 * is split into parts (`models`, `expense`) that must each fuzzy-match a
 * distinct path segment, in order. So every result is guaranteed to have a
 * parent folder matching `models` followed by a later folder/file matching
 * `expense` — paths lacking that structure are excluded entirely, not just
 * ranked lower. A query with no separator stays a loose whole-path match.
 */

export interface FuzzyMatch {
  score: number
  /** indices into the target string that matched, for highlighting */
  indices: number[]
}

const MATCH_SCORE = 1
const BONUS_BOUNDARY = 8
const BONUS_CAMEL = 6
const BONUS_CONSECUTIVE = 4
const BONUS_BASENAME = 6
/** Per-character penalty for an unmatched char inside a gap between two matches. */
const GAP_PENALTY = -1
/** Tiebreak: prefer a segment the part fills tightly (so `user` beats `users_controller`). */
const SEGMENT_SLACK_PENALTY = 0.5
const NEG = -1e9

function isBoundaryChar(c: string): boolean {
  return c === '/' || c === '.' || c === '_' || c === '-' || c === ' '
}

/** Position-only bonus for matching at `j` (boundary/camel + basename), excluding consecutiveness. */
function charBonus(target: string, j: number, basenameStart: number): number {
  let b = 0
  if (j === 0 || isBoundaryChar(target[j - 1])) b += BONUS_BOUNDARY
  else if (target[j] >= 'A' && target[j] <= 'Z' && target[j - 1] >= 'a' && target[j - 1] <= 'z') {
    b += BONUS_CAMEL
  }
  if (j >= basenameStart) b += BONUS_BASENAME
  return b
}

// Reusable DP scratch buffers (the matcher runs single-threaded in a worker and
// is never re-entrant), so per-candidate matching allocates nothing.
let scratchH = new Float64Array(0)
let scratchParent = new Int32Array(0)

/**
 * Optimal-alignment fuzzy match of a single (separator-free) query against the
 * window `target[lo, hi)`, scored with global positions so boundary/basename
 * bonuses stay correct even when the window is one path segment. Unlike a
 * greedy left-to-right scan, it finds the alignment that maximizes the score,
 * so a contiguous run near the basename beats scattered early characters.
 * Returns global indices into `target`. O(query × window) per candidate.
 */
function coreMatch(
  q: string,
  target: string,
  t: string,
  basenameStart: number,
  lo: number,
  hi: number
): FuzzyMatch | null {
  const n = q.length
  if (n === 0) return { score: 0, indices: [] }
  const w = hi - lo
  if (n > w) return null

  // fast subsequence reject within the window
  let qi = 0
  for (let ti = lo; ti < hi && qi < n; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  if (qi < n) return null

  // H[i*w + c] = best score aligning q[0..i] with q[i] at column c (target lo+c).
  // parent[i*w + c] = column in row i-1 we came from (-1 for the first query char).
  // Reused scratch: H must be cleared (it's read across rows); parent need not be
  // (backtracking only follows pointers into cells the DP explicitly wrote).
  const size = n * w
  if (scratchH.length < size) {
    scratchH = new Float64Array(size)
    scratchParent = new Int32Array(size)
  }
  const H = scratchH
  const parent = scratchParent
  H.fill(NEG, 0, size)

  // Row 0: each occurrence of q[0] starts an alignment; no leading-gap penalty
  // so deep windows stay reachable — basename bonus alone differentiates depth.
  for (let c = 0; c < w; c++) {
    const j = lo + c
    if (t[j] === q[0]) H[c] = MATCH_SCORE + charBonus(target, j, basenameStart)
  }

  for (let i = 1; i < n; i++) {
    const row = i * w
    const prevRow = (i - 1) * w
    // Running max of G[k] = H[i-1][k] - GAP_PENALTY*k over eligible k <= c-2,
    // so a gap of length L between matches costs GAP_PENALTY*L (affine-gap trick).
    let bestG = NEG
    let bestGArg = -1
    for (let c = 0; c < w; c++) {
      const j = lo + c
      const k = c - 2
      if (k >= 0 && H[prevRow + k] > NEG) {
        const g = H[prevRow + k] - GAP_PENALTY * k
        if (g > bestG) {
          bestG = g
          bestGArg = k
        }
      }
      if (t[j] !== q[i]) continue
      const matchScore = MATCH_SCORE + charBonus(target, j, basenameStart)
      let best = NEG
      let from = -1
      // Consecutive: q[i-1] matched at c-1.
      if (c - 1 >= 0 && H[prevRow + (c - 1)] > NEG) {
        const cons = H[prevRow + (c - 1)] + matchScore + BONUS_CONSECUTIVE
        if (cons > best) {
          best = cons
          from = c - 1
        }
      }
      // Gap: q[i-1] matched at some k <= c-2.
      if (bestGArg >= 0) {
        const gap = bestG + GAP_PENALTY * (c - 1) + matchScore
        if (gap > best) {
          best = gap
          from = bestGArg
        }
      }
      H[row + c] = best
      parent[row + c] = from
    }
  }

  // Best end column for the last query char.
  const lastRow = (n - 1) * w
  let score = NEG
  let endC = -1
  for (let c = 0; c < w; c++) {
    if (H[lastRow + c] > score) {
      score = H[lastRow + c]
      endC = c
    }
  }
  if (endC < 0) return null

  // Backtrack to recover matched indices (global positions).
  const indices: number[] = []
  let c = endC
  for (let i = n - 1; i >= 0; i--) {
    indices.push(lo + c)
    c = parent[i * w + c]
  }
  indices.reverse()

  return { score, indices }
}

/** Split a query into parts on the hard separators `/` and `.`, dropping empties. */
function splitParts(query: string): string[] {
  return query.split(/[/.]+/).filter((p) => p.length > 0)
}

// Reusable buffers for path segmentation and the segment-assignment DP, so a
// matched path allocates nothing beyond its small result.
let segStartBuf = new Int32Array(0)
let segEndBuf = new Int32Array(0)
let dpScoreBuf = new Float64Array(0)
let dpFromBuf = new Int32Array(0)
let segMatchBuf: Array<FuzzyMatch | null> = []

/** Fill `segStartBuf`/`segEndBuf` with the `/`- and `.`-delimited segments of `t`; returns the count. */
function buildSegments(t: string): number {
  const len = t.length
  if (segStartBuf.length < len + 1) {
    segStartBuf = new Int32Array(len + 1)
    segEndBuf = new Int32Array(len + 1)
  }
  let nS = 0
  let start = 0
  for (let i = 0; i <= len; i++) {
    if (i === len || t[i] === '/' || t[i] === '.') {
      if (i > start) {
        segStartBuf[nS] = start
        segEndBuf[nS] = i
        nS++
      }
      start = i + 1
    }
  }
  return nS
}

/**
 * Allocation-free feasibility test: can every part be assigned to a distinct,
 * strictly-increasing segment that contains it as a subsequence? Greedily
 * assigning each part to the earliest still-available segment is optimal for
 * this ordered-injective matching, so this is the exact necessary-and-
 * sufficient inclusion condition — letting non-matches bail out before any
 * segment/DP work. `qParts` and `t` must already be lowercased.
 */
function feasibleAssignment(qParts: string[], t: string): boolean {
  const nP = qParts.length
  const len = t.length
  let pi = 0
  let segStart = 0
  for (let i = 0; i <= len && pi < nP; i++) {
    if (i === len || t[i] === '/' || t[i] === '.') {
      if (i > segStart) {
        const part = qParts[pi]
        let qi = 0
        for (let k = segStart; k < i && qi < part.length; k++) {
          if (t[k] === part[qi]) qi++
        }
        if (qi === part.length) pi++
      }
      segStart = i + 1
    }
  }
  return pi === nP
}

/**
 * Strict segmented match: each query part must fuzzy-match a distinct path
 * segment, with parts assigned to segments in strictly increasing order.
 * Total score is the sum of per-segment scores; paths that can't satisfy the
 * ordering for every part are rejected. `qParts`/`t` are already lowercased.
 */
function segmentedMatch(
  qParts: string[],
  target: string,
  t: string,
  basenameStart: number
): FuzzyMatch | null {
  // Cheap allocation-free reject for the (overwhelmingly common) non-match.
  if (!feasibleAssignment(qParts, t)) return null

  const nP = qParts.length
  const nS = buildSegments(t)
  if (nP > nS) return null

  // dp[i*nS + s] = best total score for parts[0..i] with part i placed in
  // segment s; dpFrom = the segment chosen for part i-1; segMatch caches the
  // per-segment match for highlight reconstruction. All buffers are reused.
  const size = nP * nS
  if (dpScoreBuf.length < size) {
    dpScoreBuf = new Float64Array(size)
    dpFromBuf = new Int32Array(size)
    segMatchBuf = new Array(size)
  }
  const dpScore = dpScoreBuf
  const dpFrom = dpFromBuf
  const segM = segMatchBuf
  dpScore.fill(NEG, 0, size)

  for (let i = 0; i < nP; i++) {
    // Prefix best of the previous part's row, restricted to segments < s.
    let prefBest = NEG
    let prefArg = -1
    for (let s = 0; s < nS; s++) {
      if (i > 0 && s - 1 >= 0) {
        const v = dpScore[(i - 1) * nS + (s - 1)]
        if (v > prefBest) {
          prefBest = v
          prefArg = s - 1
        }
      }
      const m = coreMatch(qParts[i], target, t, basenameStart, segStartBuf[s], segEndBuf[s])
      segM[i * nS + s] = m
      if (!m) continue
      // Penalize leftover segment chars so a part prefers the segment it fills
      // tightest (`user` → `user`, not the prefix of `users_controller`).
      const slack = segEndBuf[s] - segStartBuf[s] - qParts[i].length
      const adj = m.score - SEGMENT_SLACK_PENALTY * slack
      if (i === 0) {
        dpScore[i * nS + s] = adj
      } else if (prefArg >= 0) {
        dpScore[i * nS + s] = adj + prefBest
        dpFrom[i * nS + s] = prefArg
      }
    }
  }

  let score = NEG
  let endS = -1
  for (let s = 0; s < nS; s++) {
    const v = dpScore[(nP - 1) * nS + s]
    if (v > score) {
      score = v
      endS = s
    }
  }
  if (endS < 0) return null

  // Backtrack to the segment chosen per part, then gather highlight indices.
  const chosen: number[] = []
  let s = endS
  for (let i = nP - 1; i >= 0; i--) {
    chosen.push(s)
    s = dpFrom[i * nS + s]
  }
  chosen.reverse()

  const indices: number[] = []
  for (let i = 0; i < nP; i++) {
    const m = segM[i * nS + chosen[i]]
    if (m) for (const idx of m.indices) indices.push(idx)
  }

  return { score, indices }
}

/** Parsed query: empty, a single loose token, or several separator-split parts. */
type ParsedQuery =
  | { kind: 'empty' }
  | { kind: 'loose'; q: string }
  | { kind: 'strict'; parts: string[] }

/** Parse a raw query once (lowercasing parts) so `rankPaths` needn't re-split per path. */
function parseQuery(query: string): ParsedQuery {
  if (query.length === 0) return { kind: 'empty' }
  const parts = splitParts(query)
  if (parts.length === 0) return { kind: 'empty' }
  if (parts.length === 1) return { kind: 'loose', q: parts[0].toLowerCase() }
  return { kind: 'strict', parts: parts.map((p) => p.toLowerCase()) }
}

function matchParsed(parsed: ParsedQuery, target: string): FuzzyMatch | null {
  if (parsed.kind === 'empty') return { score: 0, indices: [] }
  const t = target.toLowerCase()
  const basenameStart = target.lastIndexOf('/') + 1
  if (parsed.kind === 'loose') {
    return coreMatch(parsed.q, target, t, basenameStart, 0, target.length)
  }
  return segmentedMatch(parsed.parts, target, t, basenameStart)
}

/**
 * Match `query` against `target`. When the query contains a hard separator
 * (`/` or `.`) it is split and matched segment-by-segment (see file header);
 * otherwise it is a loose whole-path fuzzy match.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  return matchParsed(parseQuery(query), target)
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

  const parsed = parseQuery(query)
  const matches: RankedItem[] = []
  for (const path of paths) {
    const m = matchParsed(parsed, path)
    if (m) matches.push({ path, score: m.score, indices: m.indices })
  }
  matches.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1))
  return { items: matches.slice(0, limit), total: matches.length }
}
