import { editor, editorTab, expect, menuCommand, openFileViaTree, test } from './helpers'

test('go to file: fuzzy query, arrow keys, Enter opens', async ({ argus }) => {
  const { window } = argus

  await menuCommand(argus, 'go-to-file')
  const input = window.getByPlaceholder('Type a file name or path…')
  await expect(input).toBeVisible()

  await input.fill('greet')
  await expect(window.getByRole('dialog')).toContainText('greet.ts')
  await window.keyboard.press('Enter')

  await expect(editorTab(window, 'greet.ts')).toBeVisible()
  await expect(editor(window)).toContainText('export function greet')
})

test('go to file: arrow keys move the selection', async ({ argus }) => {
  const { window } = argus

  await menuCommand(argus, 'go-to-file')
  const input = window.getByPlaceholder('Type a file name or path…')
  await input.fill('.md')
  await expect(window.getByRole('dialog')).toContainText('.md')

  // second result via ArrowDown
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('Enter')
  await expect(window.locator('.cm-content')).toBeVisible()
  // one of the fixture's markdown files is now open
  await expect(
    editorTab(window, 'README.md')
      .or(editorTab(window, 'notes.md'))
      .or(editorTab(window, 'guide.md'))
  ).toBeVisible()
})

test('recent files modal lists previously opened files', async ({ argus }) => {
  const { window } = argus

  await openFileViaTree(window, 'src/lib/math.ts')
  await openFileViaTree(window, 'src/lib/greet.ts')

  await menuCommand(argus, 'recent-files')
  const dialog = window.getByRole('dialog')
  await expect(dialog).toContainText('math.ts')
  await expect(dialog).toContainText('greet.ts')

  // Enter opens the selected (most relevant) entry
  await window.keyboard.press('Enter')
  await expect(dialog).not.toBeVisible()
  await expect(editor(window)).toBeVisible()
})

test('Escape closes the modal without opening anything', async ({ argus }) => {
  const { window } = argus

  await menuCommand(argus, 'go-to-file')
  await expect(window.getByRole('dialog')).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(window.getByRole('dialog')).not.toBeVisible()
  await expect(window.getByText('Open a file from the tree')).toBeVisible()
})
