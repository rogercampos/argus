import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { electronStub, type StubBrowserWindow } from '../../test/electronStub'
import { initStateDir, loadAppState, saveAppState } from './state'
import {
  findWorkspaceWindow,
  isQuitting,
  markQuitting,
  openWelcomeWindow,
  openWorkspaceWindow,
  persistAppState,
  restoreSession,
  workspaceForWindow
} from './windows'

describe('window management (spec 01)', () => {
  let stateDir: string

  beforeAll(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'argus-windows-state-'))
    initStateDir(stateDir)
  })

  afterAll(() => {
    rmSync(stateDir, { recursive: true, force: true })
  })

  it('welcome window is a singleton', () => {
    const first = openWelcomeWindow() as unknown as StubBrowserWindow
    const second = openWelcomeWindow() as unknown as StubBrowserWindow
    expect(second).toBe(first)
    expect(first.options.additionalArguments).toBeUndefined()
    expect(
      (first.options.webPreferences as { additionalArguments: string[] }).additionalArguments
    ).toEqual(['--argus-welcome'])
  })

  it('opening a workspace closes the welcome window and tags the renderer', () => {
    const welcome = openWelcomeWindow() as unknown as StubBrowserWindow
    const workspace = openWorkspaceWindow('/tmp/project-a') as unknown as StubBrowserWindow

    expect(welcome.destroyed).toBe(true)
    expect(
      (workspace.options.webPreferences as { additionalArguments: string[] }).additionalArguments
    ).toEqual(['--argus-workspace=/tmp/project-a'])
    expect(workspaceForWindow(workspace.id)).toBe('/tmp/project-a')
    expect(findWorkspaceWindow('/tmp/project-a')).toBe(workspace as never)
    expect(findWorkspaceWindow('/tmp/other')).toBeNull()
  })

  it('reopening the same workspace focuses the existing window', () => {
    const first = openWorkspaceWindow('/tmp/project-a')
    const again = openWorkspaceWindow('/tmp/project-a')
    expect(again).toBe(first)
  })

  it('closing the last workspace window reopens welcome', () => {
    const workspace = openWorkspaceWindow('/tmp/project-a') as unknown as StubBrowserWindow
    const before = electronStub.liveWindows().length
    workspace.close()
    // welcome respawned in the closed handler
    expect(electronStub.liveWindows().length).toBe(before)
    expect(workspaceForWindow(workspace.id)).toBeNull()
  })

  it('persistAppState records every workspace window with bounds', async () => {
    const a = openWorkspaceWindow('/tmp/persist-a') as unknown as StubBrowserWindow
    a.setBounds({ x: 10, y: 20, width: 1200, height: 800 })
    openWorkspaceWindow('/tmp/persist-b')

    await persistAppState()
    const state = await loadAppState()
    const paths = state?.windows.map((w) => w.workspacePath)
    expect(paths).toContain('/tmp/persist-a')
    expect(paths).toContain('/tmp/persist-b')
    const entryA = state?.windows.find((w) => w.workspacePath === '/tmp/persist-a')
    expect(entryA?.bounds).toMatchObject({ width: 1200, height: 800 })
  })

  it('restoreSession prefers ARGUS_OPEN', async () => {
    process.env.ARGUS_OPEN = '/tmp/from-env'
    try {
      await restoreSession()
      expect(findWorkspaceWindow('/tmp/from-env')).not.toBeNull()
    } finally {
      delete process.env.ARGUS_OPEN
    }
  })

  it('restoreSession reopens saved windows, dropping degenerate bounds', async () => {
    await saveAppState({
      windows: [
        {
          workspacePath: '/tmp/restored-good',
          bounds: { x: 5, y: 6, width: 1000, height: 700 }
        },
        {
          workspacePath: '/tmp/restored-degenerate',
          bounds: { x: 0, y: 0, width: 1, height: 1 }
        }
      ]
    })
    await restoreSession()

    const good = findWorkspaceWindow('/tmp/restored-good') as unknown as StubBrowserWindow
    const degenerate = findWorkspaceWindow(
      '/tmp/restored-degenerate'
    ) as unknown as StubBrowserWindow
    expect(good.getBounds()).toMatchObject({ width: 1000, height: 700 })
    // degenerate bounds are ignored: the default window size applies
    expect(degenerate.getBounds().width).toBeGreaterThan(100)
  })

  it('restoreSession falls back to welcome with no saved state', async () => {
    // point state somewhere empty and close all windows silently
    markQuitting()
    expect(isQuitting()).toBe(true)
    for (const window of electronStub.liveWindows()) window.close()
    initStateDir(mkdtempSync(join(tmpdir(), 'argus-windows-empty-')))

    const before = electronStub.liveWindows().length
    await restoreSession()
    expect(electronStub.liveWindows().length).toBe(before + 1)
  })
})
