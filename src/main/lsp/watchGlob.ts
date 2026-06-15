import { relative, sep } from 'node:path'

/**
 * Matching for LSP file-watcher glob patterns (spec: DidChangeWatchedFiles
 * dynamic registration). A registered glob is either a bare pattern, relative
 * to the workspace, or a `RelativePattern` ({ baseUri, pattern }).
 */

export type LspGlob = string | { baseUri: string | { uri: string }; pattern: string }

/**
 * Convert an LSP glob to an anchored RegExp. Supports the constructs language
 * servers use in watcher patterns: `*` (one segment), `**` (any segments),
 * `?` (one char) and `{a,b}` alternation.
 */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches any number of leading segments (including none); a bare
        // `**` matches anything
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 2
        } else {
          re += '.*'
          i += 1
        }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if (c === '{') {
      re += '(?:'
    } else if (c === '}') {
      re += ')'
    } else if (c === ',') {
      re += '|'
    } else if ('.+^$()|[]\\'.includes(c)) {
      re += `\\${c}`
    } else {
      re += c
    }
  }
  return new RegExp(`^${re}$`)
}

/**
 * True when `absPath` matches `glob`, resolved against `workspaceRoot` for bare
 * patterns or against the glob's own base for a RelativePattern. Paths outside
 * the base never match.
 */
export function globMatches(absPath: string, workspaceRoot: string, glob: LspGlob): boolean {
  let baseDir: string
  let pattern: string
  if (typeof glob === 'string') {
    baseDir = workspaceRoot
    pattern = glob
  } else {
    const uri = typeof glob.baseUri === 'string' ? glob.baseUri : glob.baseUri.uri
    baseDir = decodeURIComponent(uri.replace(/^file:\/\//, ''))
    pattern = glob.pattern
  }
  const rel = relative(baseDir, absPath).split(sep).join('/')
  if (rel === '..' || rel.startsWith('../')) return false
  return globToRegExp(pattern).test(rel)
}
