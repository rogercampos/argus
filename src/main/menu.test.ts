import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { type CapturedMenuItem, electronStub, StubBrowserWindow } from '../../test/electronStub'
import type { MenuCommand } from '../shared/types'
import { rebuildApplicationMenu } from './menu'
import { initStateDir, touchRecentWorkspace } from './state'

/** Every MenuCommand must be reachable from the menu (spec 02: no palette).
 * `satisfies Record<MenuCommand, …>` makes this list fail to compile when a
 * command is added to shared/types.ts without updating it here. */
const ALL_COMMANDS = Object.keys({
  'new-file': 1,
  save: 1,
  'save-all': 1,
  'close-tab': 1,
  find: 1,
  replace: 1,
  'global-search': 1,
  'global-replace': 1,
  'toggle-file-tree': 1,
  'toggle-search-panel': 1,
  'toggle-schema-panel': 1,
  'show-projects': 1,
  'reveal-active-file': 1,
  'go-to-file': 1,
  'go-to-symbol': 1,
  'recent-files': 1,
  'go-to-line': 1,
  'jump-back': 1,
  'jump-forward': 1,
  'go-to-definition': 1,
  'go-to-type-definition': 1,
  'show-hover': 1,
  'quick-fixes': 1,
  'rename-symbol': 1,
  'format-document': 1,
  'comment-line': 1,
  'duplicate-line': 1,
  'move-line-up': 1,
  'move-line-down': 1,
  'toggle-inlay-hints': 1,
  'open-settings': 1,
  'next-tab': 1,
  'previous-tab': 1,
  'copy-relative-path': 1,
  'show-slow-ops': 1
} satisfies Record<MenuCommand, 1>) as MenuCommand[]

function walk(items: CapturedMenuItem[], visit: (item: CapturedMenuItem) => void): void {
  for (const item of items) {
    visit(item)
    if (Array.isArray(item.submenu)) walk(item.submenu, visit)
  }
}

describe('application menu (spec 02)', () => {
  let stateDir: string
  let recentDir: string

  beforeAll(async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'argus-menu-state-'))
    initStateDir(stateDir)
    recentDir = join(stateDir, 'a-recent-workspace')
    mkdirSync(recentDir)
    await touchRecentWorkspace(recentDir)
    await rebuildApplicationMenu()
  })

  afterAll(() => {
    rmSync(stateDir, { recursive: true, force: true })
  })

  it('every menu command is reachable through some menu item', () => {
    const menu = electronStub.applicationMenu()
    expect(menu).not.toBeNull()

    const focused = new StubBrowserWindow()
    electronStub.setFocusedWindow(focused)
    walk(menu?.items ?? [], (item) => {
      // recents/dialog items have their own click handlers; commands all
      // funnel through webContents.send('menu', …)
      if (item.click && !item.role) item.click()
    })

    // clicking a recent-workspace item opens a window and moves focus, so
    // commands land on whichever window was focused — collect from all
    const sent = electronStub
      .windows()
      .flatMap((w) => w.webContents.sent)
      .filter((m) => m.channel === 'menu')
      .map((m) => m.args[0] as MenuCommand)
    for (const command of ALL_COMMANDS) {
      expect(sent, `command "${command}" must be in the menu`).toContain(command)
    }
  })

  it('menu commands are lost without a focused window (no crash)', () => {
    electronStub.setFocusedWindow(null)
    const menu = electronStub.applicationMenu()
    walk(menu?.items ?? [], (item) => {
      if (item.click && !item.role && item.label === 'Save') item.click()
    })
  })

  it('accelerators are unique', () => {
    const accelerators: string[] = []
    walk(electronStub.applicationMenu()?.items ?? [], (item) => {
      if (item.accelerator) accelerators.push(item.accelerator)
    })
    expect(new Set(accelerators).size).toBe(accelerators.length)
    expect(accelerators).toContain('Cmd+S')
  })

  it('lists recent workspaces with home shortened to ~', () => {
    let recentItems: CapturedMenuItem[] = []
    walk(electronStub.applicationMenu()?.items ?? [], (item) => {
      if (item.label === 'Open Recent' && Array.isArray(item.submenu)) {
        recentItems = item.submenu
      }
    })
    const expected = recentDir.replace(process.env.HOME ?? '', '~')
    expect(recentItems.map((i) => i.label)).toContain(expected)
  })

  it('shows a disabled placeholder when there are no recent workspaces', async () => {
    const { removeRecentWorkspace } = await import('./state')
    // earlier menu clicks opened workspace windows whose fire-and-forget
    // recents writes may still be in flight — retry until removal sticks
    await vi.waitFor(
      async () => {
        await removeRecentWorkspace(recentDir)
        await rebuildApplicationMenu()
        let recentItems: CapturedMenuItem[] = []
        walk(electronStub.applicationMenu()?.items ?? [], (item) => {
          if (item.label === 'Open Recent' && Array.isArray(item.submenu)) {
            recentItems = item.submenu
          }
        })
        expect(recentItems).toEqual([{ label: 'No Recent Workspaces', enabled: false }])
      },
      { timeout: 5000 }
    )
  })
})
