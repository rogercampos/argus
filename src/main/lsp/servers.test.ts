import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildServerRegistry, type ServerConfig } from './servers'

/** Command/install resolution for each server config, against fixture dirs. */
describe('server registry resolution (spec 08)', () => {
  let binDir: string
  let dataDir: string
  let projectRoot: string
  let registry: ServerConfig[]
  let emptyRegistry: ServerConfig[]

  const config = (registryList: ServerConfig[], name: string): ServerConfig => {
    const found = registryList.find((c) => c.name === name)
    if (!found) throw new Error(`no config named ${name}`)
    return found
  }

  beforeAll(() => {
    binDir = mkdtempSync(join(tmpdir(), 'argus-servers-bin-'))
    dataDir = mkdtempSync(join(tmpdir(), 'argus-servers-data-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'argus-servers-root-'))
    registry = buildServerRegistry({ PATH: binDir })
    emptyRegistry = buildServerRegistry({ PATH: '/nonexistent-dir' })
  })

  afterAll(() => {
    for (const dir of [binDir, dataDir, projectRoot]) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('registers the expected servers', () => {
    expect(registry.map((c) => c.name).sort()).toEqual([
      'bash-language-server',
      'eslint',
      'ruby-lsp',
      'sorbet',
      'vtsls'
    ])
  })

  it('ruby-lsp resolves from PATH, with a gem install fallback', async () => {
    expect(await config(emptyRegistry, 'ruby-lsp').command(projectRoot, dataDir)).toBeNull()

    writeFileSync(join(binDir, 'ruby-lsp'), '#!/bin/sh\n')
    chmodSync(join(binDir, 'ruby-lsp'), 0o755) // resolved only when executable
    expect(await config(registry, 'ruby-lsp').command(projectRoot, dataDir)).toEqual({
      cmd: join(binDir, 'ruby-lsp'),
      args: []
    })
    expect(config(registry, 'ruby-lsp').install?.(dataDir, {})).toEqual({
      cmd: 'gem',
      args: ['install', 'ruby-lsp']
    })
  })

  it('ignores a non-executable file of the same name on PATH', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'argus-servers-noexec-'))
    try {
      writeFileSync(join(dir, 'ruby-lsp'), '#!/bin/sh\n') // present but not +x
      const reg = buildServerRegistry({ PATH: dir })
      expect(await config(reg, 'ruby-lsp').command(projectRoot, dataDir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ruby-lsp settings exclude lockfile gems when asked', async () => {
    writeFileSync(
      join(projectRoot, 'Gemfile.lock'),
      'GEM\n  remote: https://rubygems.org/\n  specs:\n    rails (7.1.0)\n    sorbet-static (0.5)\n'
    )
    const cfg = config(registry, 'ruby-lsp')
    expect(await cfg.settings?.(projectRoot, { excludeGems: false })).toEqual({})
    expect(await cfg.settings?.(projectRoot, { excludeGems: true })).toEqual({
      indexing: { excludedGems: ['rails', 'sorbet-static'] }
    })
  })

  it('sorbet only activates with sorbet-static in the lockfile AND srb on PATH', async () => {
    const cfg = config(registry, 'sorbet')
    const bare = mkdtempSync(join(tmpdir(), 'argus-servers-bare-'))
    try {
      expect(await cfg.command(bare, dataDir)).toBeNull() // no lockfile
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }

    // lockfile present (written by the previous test) but no binary yet
    expect(await config(emptyRegistry, 'sorbet').command(projectRoot, dataDir)).toBeNull()

    writeFileSync(join(binDir, 'srb'), '#!/bin/sh\n')
    chmodSync(join(binDir, 'srb'), 0o755)
    expect(await cfg.command(projectRoot, dataDir)).toEqual({
      cmd: join(binDir, 'srb'),
      args: ['tc', '--lsp']
    })
  })

  it('vtsls resolves from the app data dir and sizes tsserver memory', async () => {
    const cfg = config(registry, 'vtsls')
    expect(await cfg.command(projectRoot, dataDir)).toBeNull()

    const bin = join(dataDir, 'lsp-servers/@vtsls/language-server/node_modules/.bin/vtsls')
    mkdirSync(join(bin, '..'), { recursive: true })
    writeFileSync(bin, '#!/bin/sh\n')
    expect(await cfg.command(projectRoot, dataDir)).toEqual({ cmd: bin, args: ['--stdio'] })

    expect(cfg.install?.(dataDir, {})?.cmd).toBe('npm')

    const settings = (await cfg.settings?.(projectRoot, { excludeGems: false })) as {
      typescript: { tsserver: { maxTsServerMemory: number } }
    }
    expect(settings.typescript.tsserver.maxTsServerMemory).toBeGreaterThanOrEqual(1024)
  })

  it('bash-language-server resolves from the app data dir', async () => {
    const cfg = config(registry, 'bash-language-server')
    expect(await cfg.command(projectRoot, dataDir)).toBeNull()

    const bin = join(
      dataDir,
      'lsp-servers/bash-language-server/node_modules/.bin/bash-language-server'
    )
    mkdirSync(join(bin, '..'), { recursive: true })
    writeFileSync(bin, '#!/bin/sh\n')
    expect(await cfg.command(projectRoot, dataDir)).toEqual({ cmd: bin, args: ['start'] })
  })

  it('eslint needs a config file at the project root AND the installed server', async () => {
    const cfg = config(registry, 'eslint')
    expect(await cfg.command(projectRoot, dataDir)).toBeNull() // no eslint config

    writeFileSync(join(projectRoot, '.eslintrc.json'), '{}')
    expect(await cfg.command(projectRoot, dataDir)).toBeNull() // server not installed

    const bin = join(
      dataDir,
      'lsp-servers/vscode-langservers-extracted/node_modules/.bin/vscode-eslint-language-server'
    )
    mkdirSync(join(bin, '..'), { recursive: true })
    writeFileSync(bin, '#!/bin/sh\n')
    expect(await cfg.command(projectRoot, dataDir)).toEqual({ cmd: bin, args: ['--stdio'] })
  })

  it('eslint settings detect flat configs', async () => {
    const cfg = config(registry, 'eslint')
    const legacy = (await cfg.settings?.(projectRoot, { excludeGems: false })) as Record<
      string,
      unknown
    >
    expect(JSON.stringify(legacy)).toContain('false')

    writeFileSync(join(projectRoot, 'eslint.config.js'), 'export default []\n')
    const flat = (await cfg.settings?.(projectRoot, { excludeGems: false })) as Record<
      string,
      unknown
    >
    expect(JSON.stringify(flat)).not.toBe(JSON.stringify(legacy))
  })
})
