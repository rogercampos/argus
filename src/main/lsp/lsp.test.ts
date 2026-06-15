import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ProjectRegistry } from './projects'
import {
  type CommandRunner,
  ensureRubyLspForkBundle,
  languageIdForPath,
  parseGemfileLockGems,
  rubyLspForkDir,
  rubyLspForkGemfile,
  vtslsMemory
} from './servers'

describe('project detection (spec 01/08)', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'argus-projects-'))
    // monorepo: ruby at root (Rails), js subproject, nested ruby subproject
    writeFileSync(join(root, 'Gemfile'), "source 'https://rubygems.org'\n")
    mkdirSync(join(root, 'config'))
    writeFileSync(join(root, 'config/environment.rb'), '')
    mkdirSync(join(root, 'frontend'))
    writeFileSync(join(root, 'frontend/package.json'), '{}')
    mkdirSync(join(root, 'engines/billing/app'), { recursive: true })
    writeFileSync(join(root, 'engines/billing/Gemfile'), '')
    mkdirSync(join(root, 'app/models'), { recursive: true })
    writeFileSync(join(root, 'app/models/user.rb'), 'class User; end\n')
    writeFileSync(join(root, 'frontend/index.ts'), '')
    writeFileSync(join(root, 'engines/billing/app/billing.rb'), '')
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('detects the root Rails project for a model file', async () => {
    const registry = new ProjectRegistry(root)
    const project = await registry.projectForFile(join(root, 'app/models/user.rb'))
    expect(project.root).toBe(root)
    expect(project.kinds).toContain('ruby')
    expect(project.isRails).toBe(true)
  })

  it('detects the deepest project for nested files', async () => {
    const registry = new ProjectRegistry(root)
    const js = await registry.projectForFile(join(root, 'frontend/index.ts'))
    expect(js.relRoot).toBe('frontend')
    expect(js.kinds).toContain('javascript')

    const engine = await registry.projectForFile(join(root, 'engines/billing/app/billing.rb'))
    expect(engine.relRoot).toBe('engines/billing')
  })

  it('clamps a file in a sibling dir sharing a name prefix to the workspace root', async () => {
    // a sibling like `<root>-sandbox` must not be treated as inside `<root>`
    const sibling = `${root}-sandbox`
    mkdirSync(sibling, { recursive: true })
    writeFileSync(join(sibling, 'Gemfile'), '')
    writeFileSync(join(sibling, 'stray.rb'), '')
    try {
      const registry = new ProjectRegistry(root)
      const project = await registry.projectForFile(join(sibling, 'stray.rb'))
      expect(project.root).toBe(root) // clamped, not the sibling's own Gemfile
    } finally {
      rmSync(sibling, { recursive: true, force: true })
    }
  })

  it('single-instance servers use the ancestor project (spec 08)', async () => {
    const registry = new ProjectRegistry(root)
    // detect the root first (as would happen when opening a root file)
    await registry.projectForFile(join(root, 'app/models/user.rb'))
    const engine = await registry.projectForFile(join(root, 'engines/billing/app/billing.rb'))
    const ancestor = await registry.ancestorWithKind(engine, 'ruby')
    expect(ancestor.root).toBe(root)
  })
})

describe('server configs (spec 08)', () => {
  it('parses Gemfile.lock GEM specs only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argus-lock-'))
    try {
      writeFileSync(
        join(dir, 'Gemfile.lock'),
        [
          'GIT',
          '  remote: https://github.com/x/private-gem',
          '  specs:',
          '    private-gem (1.0)',
          '',
          'GEM',
          '  remote: https://rubygems.org/',
          '  specs:',
          '    rails (7.1.0)',
          '      actionpack (= 7.1.0)',
          '    rspec (3.13.0)',
          '',
          'PLATFORMS',
          '  arm64-darwin'
        ].join('\n')
      )
      const gems = await parseGemfileLockGems(dir)
      expect(gems).toEqual(['rails', 'rspec'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('computes vtsls memory per the spec formula', () => {
    expect(vtslsMemory(0)).toBe(1024)
    expect(vtslsMemory(1000)).toBe(1518)
    expect(vtslsMemory(100000)).toBe(8192)
  })

  it('maps paths to language ids', () => {
    expect(languageIdForPath('app/models/user.rb')).toBe('ruby')
    expect(languageIdForPath('Gemfile')).toBe('ruby')
    expect(languageIdForPath('lib/tasks/db.rake')).toBe('ruby')
    expect(languageIdForPath('src/App.tsx')).toBe('typescriptreact')
    expect(languageIdForPath('scripts/build.sh')).toBe('shellscript')
    expect(languageIdForPath('README.md')).toBeNull()
  })
})

describe('ruby-lsp fork bundle (spec 08)', () => {
  it('generates a Gemfile that evals the project Gemfile and pins the fork to git', () => {
    const content = rubyLspForkGemfile('/proj', true)
    expect(content).toContain('eval_gemfile("/proj/Gemfile")')
    expect(content).toContain(
      'gem "ruby-lsp", git: "https://github.com/rogercampos/ruby-lsp", branch: "main"'
    )
    expect(content).not.toContain('source "https://rubygems.org"')
  })

  it('falls back to a rubygems source when the project has no Gemfile', () => {
    const content = rubyLspForkGemfile('/proj', false)
    expect(content).toContain('source "https://rubygems.org"')
    expect(content).toContain('git: "https://github.com/rogercampos/ruby-lsp"')
  })

  it('places the composed bundle under the data dir, keyed by project', () => {
    const a = rubyLspForkDir('/proj/a', '/data')
    const b = rubyLspForkDir('/proj/b', '/data')
    expect(a.startsWith('/data/lsp-servers/ruby-lsp-fork/')).toBe(true)
    expect(a).not.toBe(b) // distinct projects get distinct bundles
  })

  it('writes the bundle, seeds the lock, runs bundle install once, then reuses it', async () => {
    const project = mkdtempSync(join(tmpdir(), 'argus-fork-proj-'))
    const data = mkdtempSync(join(tmpdir(), 'argus-fork-data-'))
    try {
      writeFileSync(join(project, 'Gemfile'), "source 'https://rubygems.org'\ngem 'rake'\n")
      writeFileSync(join(project, 'Gemfile.lock'), 'GEM\n  specs:\n    rake (13.0.0)\n')

      const calls: Array<{
        cmd: string
        args: string[]
        cwd: string
        env: Record<string, string>
      }> = []
      const runner: CommandRunner = async (cmd, args, opts) => {
        calls.push({ cmd, args, cwd: opts.cwd, env: opts.env })
      }

      const gemfile = await ensureRubyLspForkBundle(project, data, { PATH: '/usr/bin' }, runner)
      expect(gemfile).toBe(join(rubyLspForkDir(project, data), 'Gemfile'))

      // ran `bundle install` once, with BUNDLE_GEMFILE pointed at the composed Gemfile
      expect(calls).toHaveLength(1)
      expect(calls[0].cmd).toBe('bundle')
      expect(calls[0].args).toEqual(['install'])
      expect(calls[0].cwd).toBe(project)
      expect(calls[0].env.BUNDLE_GEMFILE).toBe(gemfile)

      // the composed Gemfile pins the fork, and the lock was seeded from the project
      const written = readFileSync(gemfile as string, 'utf8')
      expect(written).toContain('git: "https://github.com/rogercampos/ruby-lsp"')
      expect(readFileSync(join(rubyLspForkDir(project, data), 'Gemfile.lock'), 'utf8')).toContain(
        'rake (13.0.0)'
      )

      // a second call with nothing changed reuses the bundle (no extra install)
      await ensureRubyLspForkBundle(project, data, { PATH: '/usr/bin' }, runner)
      expect(calls).toHaveLength(1)
    } finally {
      rmSync(project, { recursive: true, force: true })
      rmSync(data, { recursive: true, force: true })
    }
  })

  it('returns null when bundle install fails', async () => {
    const project = mkdtempSync(join(tmpdir(), 'argus-fork-fail-'))
    const data = mkdtempSync(join(tmpdir(), 'argus-fork-fail-data-'))
    try {
      writeFileSync(join(project, 'Gemfile'), "source 'https://rubygems.org'\n")
      const failing: CommandRunner = async () => {
        throw new Error('bundle install boom')
      }
      expect(await ensureRubyLspForkBundle(project, data, { PATH: '/usr/bin' }, failing)).toBeNull()
    } finally {
      rmSync(project, { recursive: true, force: true })
      rmSync(data, { recursive: true, force: true })
    }
  })
})
