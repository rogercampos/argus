import { existsSync, statSync } from 'node:fs'

/**
 * Command-line launch arguments. Only existing absolute directories count as
 * folders, and never `appPath` — in dev, Electron is launched with the app's
 * own directory as an argument.
 *
 *   Argus /path/to/repo                    open a workspace
 *   Argus --diff [/path/to/repo]           review uncommitted changes
 *   Argus --diff=HEAD~1 [/path/to/repo]    review a commit / range / PR
 *
 * `--diff` without a folder uses the launching shell's working directory.
 */
export type LaunchRequest =
  | { kind: 'workspace'; dir: string }
  | { kind: 'diff'; dir: string; target: string }
  | { kind: 'none' }

function isDirectory(path: string): boolean {
  return path.startsWith('/') && existsSync(path) && statSync(path).isDirectory()
}

export function parseLaunchArgs(argv: string[], cwd: string, appPath?: string): LaunchRequest {
  const args = argv.slice(1).filter((a) => a !== appPath)
  const dir = args.find((a) => !a.startsWith('--') && isDirectory(a))
  const diffArg = args.find((a) => a === '--diff' || a.startsWith('--diff='))
  if (diffArg) {
    return {
      kind: 'diff',
      dir: dir ?? cwd,
      target: diffArg === '--diff' ? '' : diffArg.slice('--diff='.length)
    }
  }
  return dir ? { kind: 'workspace', dir } : { kind: 'none' }
}
