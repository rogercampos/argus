import { editor, expect, expectFileOnDisk, menuCommand, openFileViaTree, test } from './helpers'

test('typing marks the tab dirty; Cmd+S writes to disk and clears it', async ({ argus }) => {
  const { window, repo } = argus

  await openFileViaTree(window, 'src/lib/math.ts')
  await editor(window).click()
  await window.keyboard.press('Meta+a')
  await window.keyboard.type('// fully rewritten\n')

  // the dirty dot doubles as the close button (RubyMine-style)
  await expect(window.locator('span.dot')).toBeVisible()

  await window.keyboard.press('Meta+s')
  await expect(window.locator('span.dot')).not.toBeVisible()
  await expectFileOnDisk(repo, 'src/lib/math.ts', (c) => c.startsWith('// fully rewritten'))
})

test('Save All flushes every dirty buffer', async ({ argus }) => {
  const { window, repo } = argus

  await openFileViaTree(window, 'src/lib/math.ts')
  await editor(window).click()
  await window.keyboard.type('// edit one\n')

  await openFileViaTree(window, 'src/lib/greet.ts')
  await editor(window).click()
  await window.keyboard.type('// edit two\n')

  await expect(window.locator('span.dot')).toHaveCount(2)

  await menuCommand(argus, 'save-all')
  await expect(window.locator('span.dot')).toHaveCount(0)
  await expectFileOnDisk(repo, 'src/lib/math.ts', (c) => c.includes('// edit one'))
  await expectFileOnDisk(repo, 'src/lib/greet.ts', (c) => c.includes('// edit two'))
})
