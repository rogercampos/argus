import { editor, editorTab, expect, menuCommand, openFileViaTree, test } from './helpers'

test('tabs: open several, switch by click and by menu, close', async ({ argus }) => {
  const { window } = argus

  await openFileViaTree(window, 'src/index.ts')
  await openFileViaTree(window, 'src/lib/math.ts')
  await openFileViaTree(window, 'src/lib/greet.ts')

  for (const name of ['index.ts', 'math.ts', 'greet.ts']) {
    await expect(editorTab(window, name)).toBeVisible()
  }
  // last opened is active
  await expect(editor(window)).toContainText('export function greet')

  // switch by clicking another tab
  await editorTab(window, 'math.ts').click()
  await expect(editor(window)).toContainText('export function subtract')

  // cycle with next/previous-tab (menu commands)
  await menuCommand(argus, 'next-tab')
  await expect(editor(window)).toContainText('export function greet')
  await menuCommand(argus, 'previous-tab')
  await expect(editor(window)).toContainText('export function subtract')

  // close the active tab via menu; its neighbor becomes active
  await menuCommand(argus, 'close-tab')
  await expect(editorTab(window, 'math.ts')).not.toBeVisible()
  await expect(editorTab(window, 'index.ts')).toBeVisible()
  await expect(editorTab(window, 'greet.ts')).toBeVisible()
})

test('the × button closes a tab', async ({ argus }) => {
  const { window } = argus

  await openFileViaTree(window, 'README.md')
  await expect(editorTab(window, 'README.md')).toBeVisible()

  await window.getByTitle('Close tab').click()
  await expect(editorTab(window, 'README.md')).not.toBeVisible()
  await expect(window.getByText('Open a file from the tree')).toBeVisible()
})
