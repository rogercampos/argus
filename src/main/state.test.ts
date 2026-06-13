import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defaultWorkspaceState } from '../shared/types'
import {
  initStateDir,
  listRecentWorkspaces,
  loadAppState,
  loadFileViewState,
  loadKeymap,
  loadRecentWorkspaces,
  loadWorkspaceState,
  pruneFileViewStates,
  removeRecentWorkspace,
  saveAppState,
  saveFileViewState,
  saveKeymap,
  saveWorkspaceState,
  touchRecentWorkspace,
  workspaceHash
} from './state'

describe('state persistence', () => {
  let dir: string
  let wsA: string
  let wsB: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'argus-state-test-'))
    initStateDir(dir)
    wsA = join(dir, 'workspace-a')
    wsB = join(dir, 'workspace-b')
    mkdirSync(wsA)
    mkdirSync(wsB)
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null/empty for missing state', async () => {
    expect(await loadAppState()).toBeNull()
    expect(await loadRecentWorkspaces()).toEqual([])
    expect(await loadWorkspaceState(wsA)).toBeNull()
  })

  it('round-trips app state', async () => {
    const state = {
      windows: [{ workspacePath: wsA, bounds: { x: 0, y: 0, width: 1400, height: 900 } }]
    }
    await saveAppState(state)
    expect(await loadAppState()).toEqual(state)
  })

  it('upserts recent workspaces most-recent-first and dedups', async () => {
    await touchRecentWorkspace(wsA)
    await touchRecentWorkspace(wsB)
    await touchRecentWorkspace(wsA)
    const list = await loadRecentWorkspaces()
    expect(list.map((e) => e.path)).toEqual([wsA, wsB])
  })

  it('listRecentWorkspaces drops folders that no longer exist', async () => {
    await touchRecentWorkspace(join(dir, 'does-not-exist'))
    const list = await listRecentWorkspaces(10)
    expect(list.map((e) => e.path)).toEqual([wsA, wsB])
  })

  it('removeRecentWorkspace deletes the entry permanently', async () => {
    await touchRecentWorkspace(wsA)
    await touchRecentWorkspace(wsB)
    await removeRecentWorkspace(wsB)
    const list = await loadRecentWorkspaces()
    expect(list.map((e) => e.path)).not.toContain(wsB)
    expect(list.map((e) => e.path)).toContain(wsA)
    // restore for the following tests
    await touchRecentWorkspace(wsB)
    await touchRecentWorkspace(wsA)
  })

  it('listRecentWorkspaces respects the limit', async () => {
    const list = await listRecentWorkspaces(1)
    expect(list).toHaveLength(1)
    expect(list[0].path).toBe(wsA)
  })

  it('round-trips workspace state, isolated per workspace', async () => {
    const stateA = defaultWorkspaceState()
    stateA.panels.leftWidth = 333
    stateA.starredFolders = ['app']
    await saveWorkspaceState(wsA, stateA)
    expect(await loadWorkspaceState(wsA)).toEqual(stateA)
    expect(await loadWorkspaceState(wsB)).toBeNull()
  })

  it('round-trips per-file view state', async () => {
    await saveFileViewState(wsA, 'src/index.ts', { cursorOffset: 42, scrollTop: 100 })
    expect(await loadFileViewState(wsA, 'src/index.ts')).toEqual({
      cursorOffset: 42,
      scrollTop: 100
    })
    expect(await loadFileViewState(wsA, 'src/other.ts')).toBeNull()
  })

  it('caps per-file view states so they cannot grow without bound', async () => {
    const ws = join(dir, 'workspace-prune')
    mkdirSync(ws)
    for (let i = 0; i < 6; i++) {
      await saveFileViewState(ws, `f${i}.ts`, { cursorOffset: i, scrollTop: 0 })
    }
    const filesDir = join(dir, 'state', 'workspaces', workspaceHash(ws), 'files')
    expect(readdirSync(filesDir)).toHaveLength(6) // under the default cap

    await pruneFileViewStates(ws, 3)
    expect(readdirSync(filesDir)).toHaveLength(3) // oldest dropped to the cap
  })

  it('round-trips the keyboard keymap (default when absent)', async () => {
    expect(await loadKeymap()).toEqual({ template: 'rubymine', overrides: {} })
    await saveKeymap({ template: 'vscode', overrides: { save: 'Mod+Alt+S' } })
    expect(await loadKeymap()).toEqual({ template: 'vscode', overrides: { save: 'Mod+Alt+S' } })
  })

  it('workspaceHash is stable and path-distinct', () => {
    expect(workspaceHash('/a/b')).toBe(workspaceHash('/a/b'))
    expect(workspaceHash('/a/b')).not.toBe(workspaceHash('/a/c'))
    expect(workspaceHash('/a/b')).toMatch(/^[0-9a-f]{32}$/)
  })

  it('treats corrupt state files as missing', async () => {
    writeFileSync(join(dir, 'state', 'app.json'), '{ not json !!!')
    expect(await loadAppState()).toBeNull()

    writeFileSync(join(dir, 'state', 'recent-workspaces.json'), 'null')
    expect(await loadRecentWorkspaces()).toEqual([])
  })
})
