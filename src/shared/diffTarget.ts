import type { DiffSource } from './types'

/**
 * One text field / CLI argument describes what a diff window shows, in the
 * spirit of `git diff` and difit:
 *
 *   ""  "."  "working"      uncommitted changes (HEAD vs working tree)
 *   "staged"                HEAD vs the index
 *   "#42"  "42"  PR URL     a GitHub pull request
 *   "main...feature"        feature since it branched off main
 *   "a1b2c3..d4e5f6"        a direct comparison of two revisions
 *   anything else           a single commit vs its parent (HEAD, HEAD~2, sha…)
 */

const PR_URL = /^https?:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/(\d+)/

export function parseDiffTarget(input: string): DiffSource {
  const target = input.trim()
  const lower = target.toLowerCase()
  if (target === '' || target === '.' || lower === 'working' || lower === 'uncommitted') {
    return { kind: 'uncommitted' }
  }
  if (lower === 'staged') return { kind: 'staged' }
  if (/^#?\d+$/.test(target)) return { kind: 'pr', ref: target.replace('#', '') }
  if (PR_URL.test(target)) return { kind: 'pr', ref: target }

  const threeDot = target.indexOf('...')
  if (threeDot !== -1) {
    return {
      kind: 'range',
      base: target.slice(0, threeDot) || 'HEAD',
      head: target.slice(threeDot + 3) || 'HEAD',
      mergeBase: true
    }
  }
  const twoDot = target.indexOf('..')
  if (twoDot !== -1) {
    return {
      kind: 'range',
      base: target.slice(0, twoDot) || 'HEAD',
      head: target.slice(twoDot + 2) || 'HEAD',
      mergeBase: false
    }
  }
  return { kind: 'commit', ref: target }
}

/** The inverse of parseDiffTarget, for showing the current source in the field. */
export function formatDiffTarget(source: DiffSource): string {
  switch (source.kind) {
    case 'uncommitted':
      return 'working'
    case 'staged':
      return 'staged'
    case 'commit':
      return source.ref
    case 'range':
      return `${source.base}${source.mergeBase ? '...' : '..'}${source.head}`
    case 'pr':
      return /^\d+$/.test(source.ref) ? `#${source.ref}` : source.ref
  }
}
