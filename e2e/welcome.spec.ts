import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { type FixtureRepo, makeFixtureRepo, sampleProjectFiles } from '../test/fixtures'
import { type LaunchedApp, launchArgus, rmrf } from './launch'

/** userData dir pre-seeded with one recent workspace. */
function seededUserData(repo: FixtureRepo): string {
  const userDataDir = mkdtempSync(join(tmpdir(), 'argus-e2e-'))
  mkdirSync(join(userDataDir, 'state'), { recursive: true })
  writeFileSync(
    join(userDataDir, 'state', 'recent-workspaces.json'),
    JSON.stringify([{ path: repo.root, lastOpen: Date.now() }])
  )
  return userDataDir
}

test.describe('welcome window', () => {
  let repo: FixtureRepo
  let launched: LaunchedApp

  test.afterEach(async () => {
    await launched.close()
    rmrf(launched.userDataDir)
    repo.cleanup()
  })

  test('with no previous session: fixed-size welcome window with Open Folder', async () => {
    repo = makeFixtureRepo({ files: sampleProjectFiles() })
    launched = await launchArgus()
    const { window, app } = launched

    await expect(window.getByRole('button', { name: 'Open Folder…' })).toBeVisible()
    expect(await app.windows()).toHaveLength(1)
    const size = await window.evaluate(() => ({
      w: globalThis.innerWidth,
      h: globalThis.innerHeight
    }))
    expect(size.w).toBe(720)
  })

  test('opens a workspace from the recent list', async () => {
    repo = makeFixtureRepo({ files: sampleProjectFiles() })
    launched = await launchArgus({ userDataDir: seededUserData(repo) })
    const { window, app } = launched

    const name = repo.root.split('/').pop() as string
    const [workspaceWindow] = await Promise.all([
      app.waitForEvent('window'),
      window.getByRole('button', { name }).click()
    ])
    await expect(workspaceWindow.getByRole('treeitem', { name: 'README.md' })).toBeVisible()
  })

  test('removes an entry from the recent list', async () => {
    repo = makeFixtureRepo({ files: sampleProjectFiles() })
    const userDataDir = seededUserData(repo)
    launched = await launchArgus({ userDataDir })
    const { window } = launched

    const name = repo.root.split('/').pop() as string
    await expect(window.getByRole('button', { name })).toBeVisible()
    await window.getByTitle('Remove from recent workspaces').click()
    await expect(window.getByRole('button', { name })).not.toBeVisible()

    await expect
      .poll(() =>
        JSON.parse(readFileSync(join(userDataDir, 'state', 'recent-workspaces.json'), 'utf8'))
      )
      .toEqual([])
  })
})
