import { constants, promises as fs } from 'node:fs'
import { join } from 'node:path'

/**
 * LSP server registry (spec 08): per-language configs with install/launch
 * commands and dynamic settings.
 */

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
      command: async () => {
        const bin = await binaryOnPath(env, 'ruby-lsp')
        return bin ? { cmd: bin, args: [] } : null
      },
      install: () => ({ cmd: 'gem', args: ['install', 'ruby-lsp'] }),
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
