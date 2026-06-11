import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Shell environment resolution (spec 08): interactive login shell with a cd
 * into the target dir so version managers (mise/rbenv/nvm/direnv hooks)
 * apply. Cached per directory.
 */

const cache = new Map<string, Promise<Record<string, string>>>()

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export async function resolveShellEnv(dir: string): Promise<Record<string, string>> {
  const cached = cache.get(dir)
  if (cached) return cached

  const promise = (async (): Promise<Record<string, string>> => {
    const shell = process.env.SHELL ?? '/bin/zsh'
    try {
      const { stdout } = await execFileAsync(
        shell,
        ['-i', '-l', '-c', `cd '${dir.replace(/'/g, "'\\''")}' && env -0`],
        { maxBuffer: 10 * 1024 * 1024, timeout: 15_000 }
      )
      const env: Record<string, string> = {}
      for (const entry of stdout.split('\0')) {
        const eq = entry.indexOf('=')
        if (eq <= 0) continue
        const name = entry.slice(0, eq)
        if (VALID_NAME.test(name)) env[name] = entry.slice(eq + 1)
      }
      return Object.keys(env).length > 0 ? env : ({ ...process.env } as Record<string, string>)
    } catch {
      return { ...process.env } as Record<string, string>
    }
  })()

  cache.set(dir, promise)
  return promise
}

/** Tool versions for the Projects view, extracted from a resolved env. */
export function extractToolVersions(env: Record<string, string>): Record<string, string> {
  const versions: Record<string, string> = {}
  const ruby = env.MISE_RUBY_VERSION ?? env.RBENV_VERSION
  if (ruby) versions.ruby = ruby
  const node = env.MISE_NODE_VERSION ?? env.NODE_VERSION
  if (node) versions.node = node
  return versions
}
