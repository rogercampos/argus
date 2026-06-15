import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { electronStub, StubBrowserWindow } from '../../../test/electronStub'
import type { LspDiagnostic } from '../../shared/types'
import { liveProcesses } from '../procRegistry'
import { LspManager } from './manager'
import type { ServerConfig } from './servers'

const FAKE_SERVER = join(__dirname, '../../../test/fakeLspServer.mjs')

/** Registry with a single fake server handling TS/JS (the external binary). */
function fakeRegistry(): ServerConfig[] {
  return [
    {
      name: 'fake-ls',
      languages: ['typescript', 'javascript'],
      projectKind: 'javascript',
      perProjectInstance: true,
      command: async () => ({ cmd: process.execPath, args: [FAKE_SERVER] })
    }
  ]
}

describe('LSP manager against a fake server (spec 08)', () => {
  let root: string
  let stub: StubBrowserWindow
  let manager: LspManager

  function diagnosticsFor(path: string): LspDiagnostic[][] {
    return stub.webContents.sent
      .filter((m) => m.channel === 'lsp:diagnostics')
      .map((m) => m.args[0] as { path: string; diagnostics: LspDiagnostic[] })
      .filter((p) => p.path === path)
      .map((p) => p.diagnostics)
  }

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'argus-lsp-mgr-')))
    writeFileSync(join(root, 'package.json'), '{"name":"fixture"}')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/app.ts'), 'const x = 1\n')
    stub = new StubBrowserWindow()
    manager = new LspManager(root, stub as unknown as BrowserWindow, fakeRegistry)
  })

  afterAll(() => {
    manager.dispose()
    rmSync(root, { recursive: true, force: true })
  })

  it('didOpen starts the server and forwards published diagnostics', async () => {
    await manager.didOpen('src/app.ts', 'const x = 1\n')
    await vi.waitFor(
      () => {
        const batches = diagnosticsFor('src/app.ts')
        expect(batches.length).toBeGreaterThan(0)
        expect(batches[batches.length - 1][0]).toMatchObject({
          message: 'len:12',
          source: 'fake',
          severity: 2
        })
      },
      { timeout: 10_000 }
    )
  })

  it('didChange re-publishes against the new content', async () => {
    await manager.didChange('src/app.ts', 'const x = 12345\n')
    await vi.waitFor(
      () => {
        const batches = diagnosticsFor('src/app.ts')
        expect(batches[batches.length - 1][0].message).toBe('len:16')
      },
      { timeout: 10_000 }
    )
  })

  it('pulls diagnostics from capable servers and merges them by source', async () => {
    // the pull is debounced 500ms after didOpen/didChange
    await vi.waitFor(
      () => {
        const merged = diagnosticsFor('src/app.ts').flat()
        expect(merged.map((d) => d.message)).toContain('pulled diagnostic')
      },
      { timeout: 10_000 }
    )
    // push and pull share the server's merge bucket: the pull supersedes
    const latest = diagnosticsFor('src/app.ts').at(-1) ?? []
    expect(latest.map((d) => d.source)).toEqual(['fake-pull'])
  })

  it('answers hover through the server', async () => {
    const hover = await manager.hover('src/app.ts', 0, 3)
    expect(hover).toEqual({ contents: 'fake hover' })
  })

  it('maps definition locations to workspace-relative paths', async () => {
    const locations = await manager.definition('src/app.ts', 0, 3, 'definition')
    expect(locations).toEqual([{ path: 'src/app.ts', line: 7, character: 3 }])
  })

  it('handles LocationLink results for type definitions', async () => {
    const locations = await manager.definition('src/app.ts', 0, 3, 'typeDefinition')
    expect(locations).toEqual([{ path: 'src/app.ts', line: 2, character: 1 }])
  })

  it('returns completions, defaulting insertText to the label', async () => {
    const items = await manager.completion('src/app.ts', 0, 3)
    expect(items).toContainEqual({
      label: 'fakeCompletion',
      kind: 6,
      detail: 'a canned item',
      insertText: 'fakeCompletion'
    })
    expect(items).toContainEqual(
      expect.objectContaining({ label: 'withInsert', insertText: 'withInsert()' })
    )
  })

  it('lists workspace symbols, excluding stub files', async () => {
    const symbols = await manager.workspaceSymbols('Fake')
    expect(symbols.map((s) => s.name)).toContain('FakeSymbol')
    expect(symbols.map((s) => s.name)).not.toContain('StubFileSymbol')
  })

  it('ignores files with no language id', async () => {
    await manager.didOpen('README.md', '# hi\n')
    expect(diagnosticsFor('README.md')).toEqual([])
  })

  it('didClose clears diagnostics', async () => {
    await manager.didClose('src/app.ts')
    const batches = diagnosticsFor('src/app.ts')
    expect(batches[batches.length - 1]).toEqual([])
  })

  it('dispose kills the spawned server process', async () => {
    manager.dispose()
    await vi.waitFor(
      () => {
        expect(liveProcesses().filter((p) => p.kind === 'lsp')).toEqual([])
      },
      { timeout: 5000 }
    )
  })
})

describe('LSP manager crash handling', () => {
  it('a crashing server does not take the manager down, and restarts are capped', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'argus-lsp-crash-')))
    writeFileSync(join(root, 'package.json'), '{}')
    writeFileSync(join(root, 'boom.ts'), 'CRASH\n')
    const stub = new StubBrowserWindow()
    const manager = new LspManager(root, stub as unknown as BrowserWindow, fakeRegistry)
    try {
      // the fake server exits as soon as it sees CRASH in a didOpen
      await manager.didOpen('boom.ts', 'CRASH\n')
      await vi.waitFor(() => expect(liveProcesses().filter((p) => p.kind === 'lsp')).toEqual([]), {
        timeout: 10_000
      })
      // the unexpected exit is surfaced to the window as a copyable crash card
      const crash = stub.webContents.sent
        .filter((m) => m.channel === 'app:crash')
        .map((m) => m.args[0] as { origin: string; title: string; summary: string })
        .find((c) => c.origin === 'lsp')
      expect(crash).toBeDefined()
      expect(crash?.title).toBe('Language server crashed')
      expect(crash?.summary).toContain('exited unexpectedly with code 1')
      // requests after the crash degrade gracefully instead of throwing
      expect(await manager.hover('boom.ts', 0, 0)).toBeNull()
    } finally {
      manager.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
})

describe('lspManagerFor lifecycle', () => {
  it('reuses one manager per window and refuses destroyed windows', async () => {
    const { lspManagerFor } = await import('./manager')
    const stub = new StubBrowserWindow()
    const window = stub as unknown as BrowserWindow
    const a = lspManagerFor(window, electronStub.userDataDir)
    const b = lspManagerFor(window, electronStub.userDataDir)
    expect(a).toBe(b)
    stub.close()
    expect(lspManagerFor(window, electronStub.userDataDir)).toBeNull()
  })
})

describe('LSP manager server install (spec 08)', () => {
  it('runs the install command once, then starts the freshly-installed server', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'argus-lsp-install-')))
    writeFileSync(join(root, 'package.json'), '{}')
    writeFileSync(join(root, 'app.ts'), 'const x = 1\n')
    const marker = join(root, 'installed-marker')

    const installable: ServerConfig[] = [
      {
        name: 'installable-ls',
        languages: ['typescript'],
        projectKind: 'javascript',
        perProjectInstance: true,
        command: async () => {
          // "installed" only once the install step created the marker
          const { existsSync } = await import('node:fs')
          return existsSync(marker) ? { cmd: process.execPath, args: [FAKE_SERVER] } : null
        },
        // the installer is an external command — a real /usr/bin/touch here
        install: () => ({ cmd: 'touch', args: [marker] })
      }
    ]

    const stub = new StubBrowserWindow()
    const manager = new LspManager(root, stub as unknown as BrowserWindow, () => installable)
    try {
      await manager.didOpen('app.ts', 'const x = 1\n')
      const hover = await vi.waitFor(
        async () => {
          const result = await manager.hover('app.ts', 0, 3)
          expect(result).not.toBeNull()
          return result
        },
        { timeout: 15_000 }
      )
      expect(hover).toEqual({ contents: 'fake hover' })

      // the one-time install reported itself as a background task
      const tasks = stub.webContents.sent.filter((m) => m.channel === 'task:update')
      const names = tasks.map((m) => (m.args[0] as { name: string }).name)
      expect(names).toContain('Installing installable-ls (one-time setup)')
    } finally {
      manager.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
})

describe('LSP manager watched-file changes (external edits / git checkout / bundle changes)', () => {
  let root: string
  let stub: StubBrowserWindow
  let manager: LspManager

  // A fake server posing as ruby-lsp: it registers **/*.rb and **/*.ts watchers
  // (see fakeLspServer.mjs) and declares a lockfile restart trigger.
  function rubyRegistry(): ServerConfig[] {
    return [
      {
        name: 'ruby-lsp',
        languages: ['ruby'],
        projectKind: 'ruby',
        perProjectInstance: false,
        restartOnChange: ['Gemfile.lock', 'gems.locked'],
        command: async () => ({ cmd: process.execPath, args: [FAKE_SERVER] })
      }
    ]
  }

  function diagnosticsFor(path: string): LspDiagnostic[][] {
    return stub.webContents.sent
      .filter((m) => m.channel === 'lsp:diagnostics')
      .map((m) => m.args[0] as { path: string; diagnostics: LspDiagnostic[] })
      .filter((p) => p.path === path)
      .map((p) => p.diagnostics)
  }

  function liveLspIds(): number[] {
    return liveProcesses()
      .filter((p) => p.kind === 'lsp')
      .map((p) => p.id)
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'argus-lsp-watch-')))
    writeFileSync(join(root, 'Gemfile'), "source 'https://rubygems.org'\n")
    mkdirSync(join(root, 'lib'))
    writeFileSync(join(root, 'lib/a.rb'), 'class A\nend\n')
    stub = new StubBrowserWindow()
    manager = new LspManager(root, stub as unknown as BrowserWindow, rubyRegistry)
  })

  afterEach(() => {
    manager.dispose()
    rmSync(root, { recursive: true, force: true })
  })

  it('forwards changes matching a registered glob and ignores the rest', async () => {
    await manager.didOpen('lib/a.rb', 'class A\nend\n') // boots the fake server

    // The server registers its watchers right after initialize; retry until the
    // registration has landed and the echoed diagnostics come back.
    await vi.waitFor(
      async () => {
        await manager.handleWatchedFileChanges([
          { type: 'update', relPath: 'lib/b.rb' },
          { type: 'create', relPath: 'src/c.ts' },
          { type: 'update', relPath: 'docs/readme.md' }
        ])
        expect(
          diagnosticsFor('lib/b.rb').some((b) => b.some((d) => d.message === 'watched:2'))
        ).toBe(true)
        // a .ts change is forwarded too — forwarding follows the registered globs,
        // not a hard-coded language, so other servers benefit the same way
        expect(
          diagnosticsFor('src/c.ts').some((b) => b.some((d) => d.message === 'watched:1'))
        ).toBe(true)
      },
      { timeout: 10_000 }
    )

    // a file type the server did not register a watcher for is never forwarded
    expect(diagnosticsFor('docs/readme.md')).toEqual([])
  }, 30_000)

  it('restarts a server when a file in its restartOnChange list changes', async () => {
    await manager.didOpen('lib/a.rb', 'class A\nend\n')
    await vi.waitFor(() => expect(liveLspIds().length).toBe(1), { timeout: 10_000 })
    const originalId = liveLspIds()[0]

    await manager.handleWatchedFileChanges([{ type: 'update', relPath: 'Gemfile.lock' }])

    // the old process is replaced by a fresh one (a real restart, not just a kill)
    await vi.waitFor(
      () => {
        const ids = liveLspIds()
        expect(ids.length).toBe(1)
        expect(ids[0]).not.toBe(originalId)
      },
      { timeout: 10_000 }
    )

    // the deliberate restart must not count toward the crash cap: the respawned
    // server is usable and re-opened the previously open document
    await vi.waitFor(
      async () => expect(await manager.hover('lib/a.rb', 0, 0)).toEqual({ contents: 'fake hover' }),
      { timeout: 10_000 }
    )
  }, 30_000)
})
