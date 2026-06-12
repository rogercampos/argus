import { test as base, expect, type Page } from '@playwright/test'
import type { MenuCommand } from '../src/shared/types'
import { type FixtureRepo, makeFixtureRepo, sampleProjectFiles } from '../test/fixtures'
import { type LaunchedApp, launchArgus, rmrf } from './launch'

/**
 * Menu commands reach the renderer over the 'menu' channel
 * (src/main/menu.ts). Sending directly on the window's webContents exercises
 * the same path as a real menu click minus the native menu itself (the
 * template wiring is covered by the main-process integration suite) — native
 * macOS menus cannot be driven by synthesized keyboard events.
 */
export async function menuCommand(launched: LaunchedApp, command: MenuCommand): Promise<void> {
  const bw = await launched.app.browserWindow(launched.window)
  await bw.evaluate((win, cmd) => win.webContents.send('menu', cmd), command)
}

/** Click through the tree to open a file: expand each ancestor, click the file. */
export async function openFileViaTree(window: Page, relPath: string): Promise<void> {
  const segments = relPath.split('/')
  for (let i = 0; i < segments.length - 1; i++) {
    const dir = window.getByRole('treeitem', { name: segments[i] })
    // clicking an expanded directory would collapse it
    if ((await dir.getAttribute('aria-expanded')) !== 'true') await dir.click()
  }
  const fileName = segments[segments.length - 1]
  await window.getByRole('treeitem', { name: fileName }).click()
  // the file is open once its editor tab exists
  await expect(editorTab(window, fileName)).toBeVisible()
}

/** An editor tab by file name (the button that activates it). Its accessible
 * name is "<icon text> <file name>", e.g. "ts greet.ts". */
export function editorTab(window: Page, fileName: string): ReturnType<Page['getByRole']> {
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return window.getByRole('button', { name: new RegExp(`${escaped}$`) })
}

/** The CodeMirror editor surface. */
export function editor(window: Page): ReturnType<Page['locator']> {
  return window.locator('.cm-content')
}

/** Wait until `relPath` on disk satisfies `predicate`. */
export async function expectFileOnDisk(
  repo: FixtureRepo,
  relPath: string,
  predicate: (content: string) => boolean
): Promise<void> {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  await expect
    .poll(
      () => {
        try {
          return predicate(readFileSync(join(repo.root, relPath), 'utf8'))
        } catch {
          return false
        }
      },
      { timeout: 10_000 }
    )
    .toBe(true)
}

export interface ArgusFixture extends LaunchedApp {
  repo: FixtureRepo
}

/**
 * Default per-test app: a sample-project fixture repo opened as the
 * workspace, isolated user data, torn down afterwards.
 */
export const test = base.extend<{ argus: ArgusFixture }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright's fixture signature requires the destructured first param
  argus: async ({}, use) => {
    const repo = makeFixtureRepo({ files: sampleProjectFiles() })
    const launched = await launchArgus({ workspace: repo.root })
    // wait for the shell to be initialized (menu listeners subscribed, file
    // list loaded) so tests can send menu commands right away
    const rootName = repo.root.split('/').pop() as string
    await expect(launched.window.getByRole('banner')).toContainText(rootName)
    await expect(launched.window.getByRole('treeitem', { name: 'README.md' })).toBeVisible()
    await use({ ...launched, repo })
    await launched.close()
    repo.cleanup()
    rmrf(launched.userDataDir)
  }
})

export { expect } from '@playwright/test'
