import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

/**
 * LSP server registry (spec 08): per-language configs with install/launch
 * commands and dynamic settings.
 */

const execFileAsync = promisify(execFile)

/** ruby-lsp is consumed from this fork (it carries our gem/project index cache). */
const RUBY_LSP_FORK_GIT = 'https://github.com/rogercampos/ruby-lsp'
const RUBY_LSP_FORK_BRANCH = 'main'

/** Runs a setup command (e.g. `bundle install`); injectable so tests don't shell out. */
export type CommandRunner = (
  cmd: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string> }
) => Promise<void>

const defaultRunner: CommandRunner = async (cmd, args, opts) => {
  await execFileAsync(cmd, args, { cwd: opts.cwd, env: opts.env })
}

export interface ServerConfig {
  name: string
  languages: string[]
  /** project kind that triggers this server */
  projectKind: 'ruby' | 'javascript' | 'shellscript'
  /** every matching project gets its own instance (vtsls) vs ancestor-shared */
  perProjectInstance: boolean
  /** resolve the launch command; null = not available for this project */
  command: (projectRoot: string, dataDir: string) => Promise<{ cmd: string; args: string[] } | null>
  /** background install when the binary is missing; null = no auto-install */
  install?: (dataDir: string, env: Record<string, string>) => { cmd: string; args: string[] }
  initializationOptions?: (projectRoot: string) => Promise<unknown>
  /** workspace/configuration + didChangeConfiguration payload */
  settings?: (projectRoot: string, ruby: { excludeGems: boolean }) => Promise<unknown>
  /** basenames whose external change should restart this server, e.g. a manifest
   * the server only reads at boot. Most servers reload live and need none. */
  restartOnChange?: readonly string[]
}

export async function parseGemfileLockGems(projectRoot: string): Promise<string[]> {
  try {
    const lock = await fs.readFile(join(projectRoot, 'Gemfile.lock'), 'utf8')
    const gems: string[] = []
    let section = ''
    let inSpecs = false
    for (const line of lock.split('\n')) {
      if (/^[A-Z ]+$/.test(line) && line.trim() !== '') {
        section = line.trim()
        inSpecs = false
        continue
      }
      if (line === '  specs:') {
        // only the GEM section's specs are rubygems-installed gems (spec 08)
        inSpecs = section === 'GEM'
        continue
      }
      if (inSpecs) {
        // top-level specs have exactly 4 spaces of indent: "    rails (7.1.0)"
        const match = /^ {4}(\S+) \(/.exec(line)
        if (match) gems.push(match[1])
        else if (!line.startsWith('      ') && line.trim() !== '') inSpecs = false
      }
    }
    return gems
  } catch {
    return []
  }
}

async function hasGemInLock(projectRoot: string, gem: string): Promise<boolean> {
  return (await parseGemfileLockGems(projectRoot)).includes(gem)
}

async function binaryOnPath(env: Record<string, string>, name: string): Promise<string | null> {
  for (const dir of (env.PATH ?? '').split(':')) {
    if (!dir) continue
    try {
      // X_OK, not mere existence: a non-executable file of the same name on
      // PATH must not be picked as the server binary
      await fs.access(join(dir, name), constants.X_OK)
      return join(dir, name)
    } catch {
      // keep looking
    }
  }
  return null
}

export async function countTsJsFiles(projectRoot: string): Promise<number> {
  let count = 0
  const pending = [projectRoot]
  while (pending.length > 0 && count < 200_000) {
    const dir = pending.pop() as string
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) pending.push(full)
      else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) count++
    }
  }
  return count
}

/** vtsls memory: clamp((512 + 0.5×files) × 1.5, 1024, 8192) MB (spec 08). */
export function vtslsMemory(fileCount: number): number {
  return Math.round(Math.min(8192, Math.max(1024, (512 + fileCount * 0.5) * 1.5)))
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/** Directory holding the generated composed bundle for a project's ruby-lsp fork. */
export function rubyLspForkDir(projectRoot: string, dataDir: string): string {
  const key = createHash('sha256').update(projectRoot).digest('hex').slice(0, 16)
  return join(dataDir, 'lsp-servers', 'ruby-lsp-fork', key)
}

/**
 * The composed Gemfile content: eval the project's Gemfile (so the server sees
 * the app's gems for indexing) and pin ruby-lsp to our fork.
 */
export function rubyLspForkGemfile(projectRoot: string, hasProjectGemfile: boolean): string {
  const lines = ['# Generated by Argus to run the ruby-lsp fork. Do not edit.']
  if (hasProjectGemfile) {
    lines.push(`eval_gemfile(${JSON.stringify(join(projectRoot, 'Gemfile'))})`)
  } else {
    lines.push('source "https://rubygems.org"')
  }
  lines.push(
    `gem "ruby-lsp", git: ${JSON.stringify(RUBY_LSP_FORK_GIT)}, ` +
      `branch: ${JSON.stringify(RUBY_LSP_FORK_BRANCH)}, require: false, group: :development`
  )
  return `${lines.join('\n')}\n`
}

/**
 * Ensure a composed bundle that pins ruby-lsp to our fork exists for `projectRoot`,
 * and return the path to its Gemfile (or null if `bundle install` failed).
 *
 * The bundle lives under the app's data dir, not the project, and seeds its lock
 * from the project's Gemfile.lock so only ruby-lsp (and its deps) are added. It is
 * refreshed when the project's lock changes or once a day, the latter so a fork
 * tracking `main` picks up new commits.
 */
export async function ensureRubyLspForkBundle(
  projectRoot: string,
  dataDir: string,
  env: Record<string, string>,
  run: CommandRunner = defaultRunner
): Promise<string | null> {
  const dir = rubyLspForkDir(projectRoot, dataDir)
  const gemfile = join(dir, 'Gemfile')
  const composedLock = join(dir, 'Gemfile.lock')
  const projectGemfile = join(projectRoot, 'Gemfile')
  const projectLock = join(projectRoot, 'Gemfile.lock')

  const hasProjectGemfile = await pathExists(projectGemfile)
  const content = rubyLspForkGemfile(projectRoot, hasProjectGemfile)

  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(gemfile, content)

  const projectLockContent = (await pathExists(projectLock))
    ? await fs.readFile(projectLock, 'utf8')
    : ''
  // The day bucket makes the bundle refresh daily so a fork on `main` is pulled.
  const day = new Date().toISOString().slice(0, 10)
  const freshness = createHash('sha256')
    .update(content)
    .update(projectLockContent)
    .update(day)
    .digest('hex')
  const freshnessFile = join(dir, 'argus-freshness')
  const fresh =
    (await fs.readFile(freshnessFile, 'utf8').catch(() => '')) === freshness &&
    (await pathExists(composedLock))

  if (fresh) return gemfile

  try {
    // Seed the composed lock from the project's so app gem versions stay pinned;
    // `bundle install` then only resolves ruby-lsp (from the fork's latest main).
    if (projectLockContent) await fs.writeFile(composedLock, projectLockContent)
    await run('bundle', ['install'], { cwd: projectRoot, env: { ...env, BUNDLE_GEMFILE: gemfile } })
    await fs.writeFile(freshnessFile, freshness)
    return gemfile
  } catch {
    return null
  }
}

export function buildServerRegistry(env: Record<string, string>): ServerConfig[] {
  return [
    {
      name: 'ruby-lsp',
      languages: ['ruby'],
      projectKind: 'ruby',
      perProjectInstance: false,
      // ruby-lsp composes a bundle and indexes gems at boot, so a lockfile change
      // must restart it. Other servers reload dependency changes live.
      restartOnChange: ['Gemfile.lock', 'gems.locked'],
      command: async (projectRoot, dataDir) => {
        // Run ruby-lsp from our fork via a composed bundle that pins it to git.
        // With BUNDLE_GEMFILE set, ruby-lsp skips its own bundle composition and
        // serves directly from this bundle, so the fork's code is the server.
        const gemfile = await ensureRubyLspForkBundle(projectRoot, dataDir, env)
        if (!gemfile) return null
        return { cmd: 'env', args: [`BUNDLE_GEMFILE=${gemfile}`, 'bundle', 'exec', 'ruby-lsp'] }
      },
      initializationOptions: async () => ({
        enabledFeatures: { semanticHighlighting: false }
      }),
      settings: async (projectRoot, ruby) => {
        if (!ruby.excludeGems) return {}
        const gems = await parseGemfileLockGems(projectRoot)
        return { indexing: { excludedGems: gems } }
      }
    },
    {
      name: 'sorbet',
      languages: ['ruby'],
      projectKind: 'ruby',
      perProjectInstance: false,
      command: async (projectRoot) => {
        if (!(await hasGemInLock(projectRoot, 'sorbet-static'))) return null
        const bin = await binaryOnPath(env, 'srb')
        return bin ? { cmd: bin, args: ['tc', '--lsp'] } : null
      }
    },
    {
      name: 'vtsls',
      languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
      projectKind: 'javascript',
      perProjectInstance: true,
      command: async (_projectRoot, dataDir) => {
        const bin = join(dataDir, 'lsp-servers/@vtsls/language-server/node_modules/.bin/vtsls')
        try {
          await fs.access(bin)
          return { cmd: bin, args: ['--stdio'] }
        } catch {
          return null
        }
      },
      install: (dataDir) => ({
        cmd: 'npm',
        args: [
          'install',
          '--prefix',
          join(dataDir, 'lsp-servers/@vtsls/language-server'),
          '@vtsls/language-server'
        ]
      }),
      settings: async (projectRoot) => {
        const memory = vtslsMemory(await countTsJsFiles(projectRoot))
        return {
          vtsls: { autoUseWorkspaceTsdk: true },
          typescript: { tsserver: { maxTsServerMemory: memory } }
        }
      }
    },
    {
      name: 'bash-language-server',
      languages: ['shellscript'],
      projectKind: 'shellscript',
      perProjectInstance: false,
      command: async (_projectRoot, dataDir) => {
        const bin = join(
          dataDir,
          'lsp-servers/bash-language-server/node_modules/.bin/bash-language-server'
        )
        try {
          await fs.access(bin)
          return { cmd: bin, args: ['start'] }
        } catch {
          return null
        }
      },
      install: (dataDir) => ({
        cmd: 'npm',
        args: [
          'install',
          '--prefix',
          join(dataDir, 'lsp-servers/bash-language-server'),
          'bash-language-server'
        ]
      })
    },
    {
      name: 'eslint',
      languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
      projectKind: 'javascript',
      perProjectInstance: false,
      command: async (projectRoot, dataDir) => {
        // only when an eslint config exists at the project root
        const candidates = [
          '.eslintrc',
          '.eslintrc.js',
          '.eslintrc.cjs',
          '.eslintrc.json',
          '.eslintrc.yml',
          '.eslintrc.yaml',
          'eslint.config.js',
          'eslint.config.mjs',
          'eslint.config.cjs',
          'eslint.config.ts'
        ]
        let hasConfig = false
        for (const c of candidates) {
          try {
            await fs.access(join(projectRoot, c))
            hasConfig = true
            break
          } catch {
            // keep looking
          }
        }
        if (!hasConfig) return null
        const bin = join(
          dataDir,
          'lsp-servers/vscode-langservers-extracted/node_modules/.bin/vscode-eslint-language-server'
        )
        try {
          await fs.access(bin)
          return { cmd: bin, args: ['--stdio'] }
        } catch {
          return null
        }
      },
      install: (dataDir) => ({
        cmd: 'npm',
        args: [
          'install',
          '--prefix',
          join(dataDir, 'lsp-servers/vscode-langservers-extracted'),
          'vscode-langservers-extracted'
        ]
      }),
      settings: async (projectRoot) => {
        let useFlatConfig = false
        for (const c of [
          'eslint.config.js',
          'eslint.config.mjs',
          'eslint.config.cjs',
          'eslint.config.ts'
        ]) {
          try {
            await fs.access(join(projectRoot, c))
            useFlatConfig = true
            break
          } catch {
            // keep looking
          }
        }
        return {
          validate: 'on',
          run: 'onType',
          quiet: false,
          onIgnoredFiles: 'off',
          rulesCustomizations: [],
          problems: { shortenToSingleLine: false },
          nodePath: '',
          codeAction: {
            disableRuleComment: { enable: true, location: 'separateLine' },
            showDocumentation: { enable: true }
          },
          workspaceFolder: { uri: `file://${projectRoot}`, name: projectRoot.split('/').pop() },
          workingDirectory: { mode: 'auto' },
          experimental: { useFlatConfig }
        }
      }
    }
  ]
}

export const LANGUAGE_ID_BY_EXT: Record<string, string> = {
  rb: 'ruby',
  rake: 'ruby',
  gemspec: 'ruby',
  ru: 'ruby',
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascriptreact',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript'
}

export function languageIdForPath(path: string): string | null {
  const base = path.split('/').pop() ?? ''
  if (base === 'Gemfile' || base === 'Rakefile' || base.endsWith('.rake')) return 'ruby'
  const ext = (base.split('.').pop() ?? '').toLowerCase()
  return LANGUAGE_ID_BY_EXT[ext] ?? null
}
