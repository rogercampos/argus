import { expect, test } from '@playwright/test'
import { sampleProjectFiles } from '../test/fixtures'
import { launchArgus, launchWithFixture } from './launch'

test('opens a workspace window showing the file tree', async () => {
  const { window, close } = await launchWithFixture({ files: sampleProjectFiles() })
  try {
    await expect(window.getByRole('treeitem', { name: 'README.md' })).toBeVisible()
    await expect(window.getByRole('treeitem', { name: 'src' })).toBeVisible()
  } finally {
    await close()
  }
})

test('shows the welcome window when there is no previous session', async () => {
  const { app, window, close } = await launchArgus()
  try {
    await window.waitForLoadState('domcontentloaded')
    expect(await app.windows()).toHaveLength(1)
    // welcome windows are small and fixed-size (720x460, spec 01)
    const size = await window.evaluate(() => ({
      w: globalThis.innerWidth,
      h: globalThis.innerHeight
    }))
    expect(size.w).toBe(720)
  } finally {
    await close()
  }
})
