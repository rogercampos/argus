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

test('tab management: close all, reopen closed, open-tabs list', async ({ argus }) => {
  const { window } = argus

  await openFileViaTree(window, 'src/index.ts')
  await openFileViaTree(window, 'src/lib/math.ts')

  await menuCommand(argus, 'close-all-tabs')
  await expect(editorTab(window, 'index.ts')).not.toBeVisible()
  await expect(editorTab(window, 'math.ts')).not.toBeVisible()

  await menuCommand(argus, 'reopen-closed-tab')
  await expect(editorTab(window, 'math.ts')).toBeVisible()
  await expect(editor(window)).toContainText('export function subtract')
  await menuCommand(argus, 'reopen-closed-tab')
  await expect(editorTab(window, 'index.ts')).toBeVisible()

  await window.getByTitle(/Show all open tabs/).click()
  await window.getByPlaceholder('Filter open tabs…').fill('math')
  await window.keyboard.press('Enter')
  await expect(editor(window)).toContainText('export function subtract')
})

test('tabs reorder by drag and drop', async ({ argus }) => {
  const { window } = argus

  await openFileViaTree(window, 'src/index.ts')
  await openFileViaTree(window, 'src/lib/math.ts')
  await openFileViaTree(window, 'src/lib/greet.ts')

  const order = (): Promise<string[]> =>
    window
      .locator('[data-tab-path]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-tab-path') ?? ''))
  await expect.poll(order).toEqual(['src/index.ts', 'src/lib/math.ts', 'src/lib/greet.ts'])

  // drop greet.ts onto the left half of index.ts → becomes first
  const target = window.locator('[data-tab-path="src/index.ts"]')
  const box = await target.boundingBox()
  if (!box) throw new Error('no tab box')
  await window
    .locator('[data-tab-path="src/lib/greet.ts"]')
    .dragTo(target, { targetPosition: { x: 4, y: box.height / 2 } })
  await expect.poll(order).toEqual(['src/lib/greet.ts', 'src/index.ts', 'src/lib/math.ts'])
})
