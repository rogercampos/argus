import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { PersistedWorkspaceState } from '../src/shared/types'
import { makeFixtureRepo, sampleProjectFiles } from '../test/fixtures'
import { editorTab, menuCommand, openFileViaTree } from './helpers'
import { launchArgus, rmrf } from './launch'

/** The single per-workspace state file under the userData dir, once written. */
function readWorkspaceState(userDataDir: string): PersistedWorkspaceState | null {
  const workspacesDir = join(userDataDir, 'state', 'workspaces')
  if (!existsSync(workspacesDir)) return null
  const hashes = readdirSync(workspacesDir)
  if (hashes.length === 0) return null
  const file = join(workspacesDir, hashes[0], 'workspace.json')
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8')) as PersistedWorkspaceState
}

test('tabs, layout, and session survive a restart', async () => {
  test.setTimeout(60_000)
  const repo = makeFixtureRepo({ files: sampleProjectFiles() })
  let launched = await launchArgus({ workspace: repo.root })
  const userDataDir = launched.userDataDir

  try {
    await openFileViaTree(launched.window, 'src/lib/math.ts')
    await openFileViaTree(launched.window, 'src/lib/greet.ts')
    const argus = { ...launched, repo }
    await menuCommand(argus, 'toggle-file-tree')
    await expect(launched.window.getByRole('treeitem', { name: 'README.md' })).not.toBeVisible()

    // workspace state lands on a 2s debounce; wait for the write
    await expect
      .poll(
        () => {
          const state = readWorkspaceState(userDataDir)
          return state
            ? {
                tabs: state.editor.openTabs.map((t) => t.path),
                left: state.panels.leftVisible
              }
            : null
        },
        { timeout: 15_000 }
      )
      .toEqual({ tabs: ['src/lib/math.ts', 'src/lib/greet.ts'], left: false })

    await launched.close()

    // relaunch WITHOUT ARGUS_OPEN: the session restores from app state
    launched = await launchArgus({ userDataDir })
    const window = launched.window

    await expect(editorTab(window, 'math.ts')).toBeVisible()
    await expect(editorTab(window, 'greet.ts')).toBeVisible()
    // greet.ts was active when we quit
    await expect(window.locator('.cm-content')).toContainText('export function greet')
    // file tree stayed hidden
    await expect(window.getByRole('treeitem', { name: 'README.md' })).not.toBeVisible()
  } finally {
    await launched.close()
    repo.cleanup()
    rmrf(userDataDir)
  }
})
