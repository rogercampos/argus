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
    // Optimal alignment prefers the word-boundary 'r' after '.' over the in-word one.
    expect(m?.indices).toEqual([0, 1, 5])
  })

  it('prefers aligning to word boundaries', () => {
    const m = fuzzyMatch('usr', 'user_repo.rb')
    // u, s, then the boundary 'r' that starts "repo" — not the 'r' inside "user".
    expect(m?.indices).toEqual([0, 1, 5])
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

  it('treats / as a hard separator that must match a parent segment', () => {
    // "models" must match a folder and "expense" a later folder/file.
    expect(fuzzyMatch('models/expense', 'app/models/expensable.rb')).not.toBeNull()
    // No "models" folder anywhere → rejected outright, not just ranked lower.
    expect(fuzzyMatch('models/expense', 'app/public/domain_events/expensables.rb')).toBeNull()
    // The "expense" part must come AFTER the "models" part.
    expect(fuzzyMatch('expense/models', 'app/models/expensable.rb')).toBeNull()
  })

  it('treats . as a hard separator (extension splitting)', () => {
    expect(fuzzyMatch('expensable.rb', 'app/models/expensable.rb')).not.toBeNull()
    // "rb" can only match the extension segment, which has no later "models".
    expect(fuzzyMatch('expensable.rb', 'app/models/expensable.py')).toBeNull()
  })

  it('a separated part must fit inside a single segment, not span the path', () => {
    // "modusr" spanning models→user is fine loosely, but "mod/usr" demands
    // "usr" live inside one segment, which "user" satisfies.
    expect(fuzzyMatch('mod/usr', 'app/models/user.rb')).not.toBeNull()
    // "modusr" as one part cannot fit in any single segment here.
    expect(fuzzyMatch('mod/usr', 'app/models/account.rb')).toBeNull()
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

// ---------------------------------------------------------------------------
// Characterization goldens + invariants. These lock the *intended* behavior so
// performance refactors can't silently change scoring, highlighting, ordering,
// or which paths are included/excluded.
// ---------------------------------------------------------------------------

/** The chars at the matched indices must equal the query with separators removed. */
function matchedChars(target: string, indices: number[]): string {
  return indices
    .map((i) => target[i])
    .join('')
    .toLowerCase()
}

describe('fuzzyMatch — exact score/indices goldens', () => {
  const goldens: Array<{ q: string; t: string; score: number; indices: number[] }> = [
    { q: 'usr', t: 'user.rb', score: 38, indices: [0, 1, 5] },
    { q: 'usr', t: 'user_repo.rb', score: 38, indices: [0, 1, 5] },
    { q: 'user', t: 'app/models/user.rb', score: 50, indices: [11, 12, 13, 16] },
    { q: 'user', t: 'user/models/apple.rb', score: 24, indices: [0, 1, 2, 3] },
    { q: 'abc', t: 'xx/abc.rb', score: 37, indices: [3, 4, 5] },
    { q: 'abc', t: 'xx/axbxc.rb', score: 27, indices: [3, 5, 7] },
    {
      q: 'models/expense',
      t: 'app/models/expensable.rb',
      score: 106.5,
      indices: [4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 20]
    },
    {
      q: 'expensable.rb',
      t: 'app/models/expensable.rb',
      score: 140,
      indices: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23]
    },
    { q: 'mod/usr', t: 'app/models/user.rb', score: 49, indices: [4, 5, 6, 11, 12, 14] },
    { q: 'm/u/a', t: 'app/models/concerns/user/account.rb', score: 26, indices: [4, 20, 25] },
    {
      q: 'lib/set',
      t: '/x/rubies/ruby-3.3.0/lib/set.rb',
      score: 56,
      indices: [21, 22, 23, 25, 26, 27]
    }
  ]

  for (const g of goldens) {
    it(`${JSON.stringify(g.q)} vs ${JSON.stringify(g.t)}`, () => {
      const m = fuzzyMatch(g.q, g.t)
      expect(m).not.toBeNull()
      expect(m?.score).toBe(g.score)
      expect(m?.indices).toEqual(g.indices)
      // Invariant: indices are strictly ascending and in bounds.
      const idx = m?.indices ?? []
      for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1])
      for (const i of idx) expect(i).toBeGreaterThanOrEqual(0)
      for (const i of idx) expect(i).toBeLessThan(g.t.length)
      // Invariant: matched chars equal the separator-stripped query.
      expect(matchedChars(g.t, idx)).toBe(g.q.replace(/[/.]+/g, '').toLowerCase())
    })
  }
})

describe('fuzzyMatch — exclusions (null)', () => {
  const nulls: Array<[string, string]> = [
    ['xyz', 'app/models/user.rb'],
    ['models/expense', 'app/public/domain_events/expensables.rb'],
    ['expense/models', 'app/models/expensable.rb'], // wrong order
    ['expensable.rb', 'app/models/expensable.py'], // ext segment has no later match
    ['mod/usr', 'app/models/account.rb'], // "usr" fits no single segment
    ['toolongquery', 'short.rb']
  ]
  for (const [q, t] of nulls) {
    it(`${JSON.stringify(q)} vs ${JSON.stringify(t)} → null`, () => {
      expect(fuzzyMatch(q, t)).toBeNull()
    })
  }
})

describe('fuzzyMatch — separator semantics', () => {
  it('is case-insensitive for both query and target across segments', () => {
    const m = fuzzyMatch('Models/Expense', 'APP/Models/Expensable.rb')
    expect(m).not.toBeNull()
  })

  it('handles three separated parts in order', () => {
    expect(fuzzyMatch('m/u/a', 'app/models/concerns/user/account.rb')).not.toBeNull()
    // Same parts, but no segment for the middle "u" before "a": still fine here,
    // yet a path missing the ordering is rejected.
    expect(fuzzyMatch('a/u/m', 'app/models/concerns/user/account.rb')).toBeNull()
  })

  it('treats leading/trailing/duplicate separators as a single split', () => {
    expect(fuzzyMatch('/models/', 'app/models/user.rb')).not.toBeNull()
    expect(fuzzyMatch('models//user', 'app/models/user.rb')).not.toBeNull()
  })

  it('a part must fit within one segment, never spanning a separator', () => {
    // "modelsuser" as one token spans two segments → fine loosely…
    expect(fuzzyMatch('modelsuser', 'app/models/user.rb')).not.toBeNull()
    // …but "models/user" demands each part inside one segment.
    expect(fuzzyMatch('models/user', 'app/models/user.rb')).not.toBeNull()
    // and "modelsu/ser" would need "modelsu" inside one segment, which fails.
    expect(fuzzyMatch('modelsu/ser', 'app/models/user.rb')).toBeNull()
  })
})

describe('rankPaths — ordering & inclusion goldens', () => {
  const repo = [
    'backend/components/expenses/app/public/expenses/models/expensable.rb',
    'backend/components/expenses/app/public/expenses/domain_events/channels/expensables.rb',
    'backend/components/iris/app/public/iris/domain_events/channels/expensables_facts.rb',
    'backend/components/expenses/app/public/expenses/domain_events/helpers/expensable_fields.rb',
    'app/models/user.rb',
    'app/controllers/users_controller.rb',
    'spec/models/user_spec.rb'
  ]

  it('models/expense keeps only the path with a real models folder', () => {
    const { items, total } = rankPaths('models/expense', repo, [], 50)
    expect(total).toBe(1)
    expect(items[0].path).toBe(
      'backend/components/expenses/app/public/expenses/models/expensable.rb'
    )
  })

  it('user.rb ranks the exact basename file first', () => {
    const { items, total } = rankPaths('user.rb', repo, [], 50)
    expect(total).toBe(3)
    expect(items.map((i) => i.path)).toEqual([
      'app/models/user.rb',
      'spec/models/user_spec.rb',
      'app/controllers/users_controller.rb'
    ])
  })

  it('loose query "user" keeps full ordering', () => {
    const { items, total } = rankPaths('user', repo, [], 50)
    expect(total).toBe(7)
    expect(items[0].path).toBe('app/models/user.rb')
  })

  it('inclusion matches a brute-force segment-assignment oracle (randomized)', () => {
    // Oracle: a path is included iff its parts can be assigned to strictly
    // increasing distinct segments, each part a subsequence of its segment.
    const isSub = (p: string, seg: string): boolean => {
      let qi = 0
      for (let k = 0; k < seg.length && qi < p.length; k++) if (seg[k] === p[qi]) qi++
      return qi === p.length
    }
    const feasible = (q: string, t: string): boolean => {
      const parts = q
        .split(/[/.]+/)
        .filter(Boolean)
        .map((s) => s.toLowerCase())
      if (parts.length <= 1) return isSub(parts[0] ?? '', t.toLowerCase())
      const segs = t.toLowerCase().split(/[/.]+/).filter(Boolean)
      // recursive assignment search
      const search = (pi: number, si: number): boolean => {
        if (pi === parts.length) return true
        for (let s = si; s < segs.length; s++) {
          if (isSub(parts[pi], segs[s]) && search(pi + 1, s + 1)) return true
        }
        return false
      }
      return search(0, 0)
    }

    const alphabet = 'abc/.'
    let seed = 99
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const randStr = (len: number, alpha: string): string => {
      let out = ''
      for (let i = 0; i < len; i++) out += alpha[Math.floor(rnd() * alpha.length)]
      return out
    }
    for (let n = 0; n < 4000; n++) {
      const q = randStr(1 + Math.floor(rnd() * 5), alphabet)
      const t = randStr(1 + Math.floor(rnd() * 12), 'abcd/.')
      const got = fuzzyMatch(q, t) !== null
      const want = feasible(q, t)
      if (got !== want) {
        throw new Error(
          `mismatch q=${JSON.stringify(q)} t=${JSON.stringify(t)} got=${got} want=${want}`
        )
      }
    }
  })

  it('loose query "expensable" ordering is stable', () => {
    const { items, total } = rankPaths('expensable', repo, [], 50)
    expect(total).toBe(4)
    expect(items.map((i) => i.path)).toEqual([
      'backend/components/expenses/app/public/expenses/domain_events/channels/expensables.rb',
      'backend/components/expenses/app/public/expenses/domain_events/helpers/expensable_fields.rb',
      'backend/components/expenses/app/public/expenses/models/expensable.rb',
      'backend/components/iris/app/public/iris/domain_events/channels/expensables_facts.rb'
    ])
  })
})
