import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ProjectRegistry } from './projects'
import { languageIdForPath, parseGemfileLockGems, vtslsMemory } from './servers'

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
