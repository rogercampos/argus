import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { electronStub, type StubBrowserWindow } from '../../test/electronStub'
import {
  type FixtureRepo,
  makeFixtureRepo,
  railsProjectFiles,
  sampleProjectFiles
} from '../../test/fixtures'
import type {
  FileReadResult,
  GitState,
  PersistedWorkspaceState,
  SearchProgress
} from '../shared/types'
import { defaultWorkspaceState } from '../shared/types'

// LSP servers must never spawn/install from these tests (gate read at import)
vi.hoisted(() => {
  process.env.ARGUS_DISABLE_LSP = '1'
})

import { registerIpcHandlers } from './ipc'
import { initStateDir } from './state'
import { openWorkspaceWindow } from './windows'

/**
 * The full IPC surface, invoked through the registered handlers with a fake
 * event carrying the window's webContents — everything from the handler down
 * (repo/search/state/git modules, real fixture repos) runs for real.
 */
describe('IPC handlers (the renderer-facing contract)', () => {
  let repo: FixtureRepo
  let window: StubBrowserWindow

  const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
    electronStub.invoke(window, channel, ...args)

  beforeAll(() => {
    initStateDir(electronStub.userDataDir)
    registerIpcHandlers()
    repo = makeFixtureRepo({ files: sampleProjectFiles() })
    window = openWorkspaceWindow(repo.root) as unknown as StubBrowserWindow
  })

  afterAll(() => {
    window.close()
    repo.cleanup()
  })

  it('repo channels list files and status', async () => {
    expect(await invoke('repo:list-files', repo.root)).toContain('src/lib/greet.ts')
    expect(await invoke('repo:list-top-level', repo.root)).toContain('src/')
    repo.write('dirty.txt', 'x\n')
    expect(await invoke('repo:git-status', repo.root)).toContainEqual({
      path: 'dirty.txt',
      status: 'untracked'
    })
  })

  it('file channels read and write inside the workspace', async () => {
    const read = (await invoke('file:read', repo.root, 'README.md')) as FileReadResult
    expect(read.ok).toBe(true)

    const write = await invoke('file:write', repo.root, 'README.md', '# rewritten\n')
    expect(write).toEqual({ ok: true })
    expect(await invoke('file:read', repo.root, 'README.md')).toEqual({
      ok: true,
      content: '# rewritten\n'
    })

    const abs = join(repo.root, 'absolute.txt')
    expect(await invoke('file:exists', abs)).toBe(false)
    await invoke('file:write-abs', abs, 'via abs\n')
    expect(await invoke('file:exists', abs)).toBe(true)
    expect(await invoke('file:read-abs', abs)).toEqual({ ok: true, content: 'via abs\n' })
  })

  it('workspace state channels are scoped to the window workspace', async () => {
    expect(await invoke('workspace:load-state')).toBeNull()
    const state: PersistedWorkspaceState = {
      ...defaultWorkspaceState(),
      recentFiles: ['src/index.ts']
    }
    await invoke('workspace:save-state', state)
    expect(await invoke('workspace:load-state')).toEqual(state)

    expect(await invoke('workspace:load-file-state', 'src/index.ts')).toBeNull()
    await invoke('workspace:save-file-state', 'src/index.ts', { cursorOffset: 7, scrollTop: 12 })
    expect(await invoke('workspace:load-file-state', 'src/index.ts')).toEqual({
      cursorOffset: 7,
      scrollTop: 12
    })
  })

  it('keymap channels load and save', async () => {
    expect(await invoke('keymap:load')).toEqual({ template: 'rubymine', overrides: {} })
    await invoke('keymap:save', { template: 'sublime', overrides: { save: 'Mod+Alt+S' } })
    expect(await invoke('keymap:load')).toEqual({
      template: 'sublime',
      overrides: { save: 'Mod+Alt+S' }
    })
  })

  it('app channels manage recents and slow ops', async () => {
    await invoke('app:open-workspace', repo.root) // touches recents, focuses existing window
    const recents = (await invoke('app:recent-workspaces', 5)) as Array<{ path: string }>
    expect(recents.map((r) => r.path)).toContain(repo.root)

    await invoke('app:remove-recent-workspace', repo.root)
    const after = (await invoke('app:recent-workspaces', 5)) as Array<{ path: string }>
    expect(after.map((r) => r.path)).not.toContain(repo.root)

    expect(Array.isArray(await invoke('app:slow-ops'))).toBe(true)
  })

  it('the folder dialog opens a workspace window only when confirmed', async () => {
    electronStub.nextOpenDialogResult = { canceled: true, filePaths: [] }
    const before = electronStub.liveWindows().length
    await invoke('app:open-folder-dialog')
    expect(electronStub.liveWindows().length).toBe(before)

    const other = makeFixtureRepo({ files: { 'a.txt': 'x\n' } })
    try {
      electronStub.nextOpenDialogResult = { canceled: false, filePaths: [other.root] }
      await invoke('app:open-folder-dialog')
      expect(electronStub.liveWindows().length).toBe(before + 1)
    } finally {
      electronStub.nextOpenDialogResult = { canceled: true, filePaths: [] }
      other.cleanup()
    }
  })

  it('search:start streams progress to the window; cancel stops a search', async () => {
    const progressFor = (searchId: number): SearchProgress[] =>
      window.webContents.sent
        .filter((m) => m.channel === 'search:progress' && m.args[0] === searchId)
        .map((m) => m.args[1] as SearchProgress)

    await invoke('search:start', 1, {
      pattern: 'alpha-bravo-charlie',
      caseSensitive: false,
      wholeWord: false,
      regex: false
    })
    await vi.waitFor(
      () => {
        const batches = progressFor(1)
        expect(batches.some((p) => p.done)).toBe(true)
        expect(batches.flatMap((p) => p.matches)).toHaveLength(2)
      },
      { timeout: 10_000 }
    )

    // cancel before the first batch flush: no results delivered
    await invoke('search:start', 2, {
      pattern: 'alpha',
      caseSensitive: false,
      wholeWord: false,
      regex: false
    })
    await invoke('search:cancel', 2)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(progressFor(2).flatMap((p) => p.matches)).toEqual([])
  })

  it('search:replace-all rewrites files and reports task progress', async () => {
    const result = (await invoke(
      'search:replace-all',
      { pattern: 'alpha-bravo-charlie', caseSensitive: false, wholeWord: false, regex: false },
      'replaced-by-ipc'
    )) as { filesChanged: number; replacements: number }
    expect(result).toEqual({ filesChanged: 2, replacements: 2 })

    const tasks = window.webContents.sent.filter((m) => m.channel === 'task:update')
    expect(tasks.length).toBeGreaterThanOrEqual(2) // started + finished at minimum
  })

  it('clipboard and reveal channels reach the shell', async () => {
    await invoke('clipboard:write', 'copied text')
    expect(electronStub.clipboardWrites).toContain('copied text')

    await invoke('shell:reveal', 'src/index.ts')
    expect(electronStub.revealedPaths).toContain(join(repo.root, 'src/index.ts'))
  })

  it('watch:start wires the git monitor to the window', async () => {
    await invoke('watch:start')
    await vi.waitFor(
      () => {
        const states = window.webContents.sent
          .filter((m) => m.channel === 'git:state')
          .map((m) => m.args[0] as GitState)
        expect(states.some((s) => s.isRepo && s.branch === 'main')).toBe(true)
      },
      { timeout: 10_000 }
    )
  })

  it('LSP channels degrade gracefully with servers disabled', async () => {
    await invoke('lsp:did-open', 'src/index.ts', 'const a = 1\n')
    await invoke('lsp:did-change', 'src/index.ts', 'const a = 2\n')
    expect(await invoke('lsp:hover', 'src/index.ts', 0, 3)).toBeNull()
    expect(await invoke('lsp:completion', 'src/index.ts', 0, 3)).toEqual([])
    expect(await invoke('lsp:definition', 'src/index.ts', 0, 3, 'definition')).toEqual([])
    expect(await invoke('lsp:workspace-symbols', 'a')).toEqual([])
    await invoke('lsp:did-close', 'src/index.ts')
  })

  it('rails:schema-for resolves models through the project registry', async () => {
    const rails = makeFixtureRepo({ files: railsProjectFiles() })
    const railsWindow = openWorkspaceWindow(rails.root) as unknown as StubBrowserWindow
    try {
      const info = (await electronStub.invoke(
        railsWindow,
        'rails:schema-for',
        'app/models/user.rb'
      )) as { table: string } | null
      expect(info?.table).toBe('users')

      expect(
        await electronStub.invoke(railsWindow, 'rails:schema-for', 'app/models/missing.rb')
      ).toBeNull()
    } finally {
      railsWindow.close()
      rails.cleanup()
    }
  })

  it('rejects workspace-scoped channels from non-workspace windows', async () => {
    const { openWelcomeWindow } = await import('./windows')
    const welcome = openWelcomeWindow() as unknown as StubBrowserWindow
    try {
      await expect(electronStub.invoke(welcome, 'workspace:load-state')).rejects.toThrow(
        'No workspace'
      )
    } finally {
      welcome.close()
    }
  })
})
