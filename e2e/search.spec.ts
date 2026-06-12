import { editorTab, expect, menuCommand, test } from './helpers'

const NEEDLE = 'alpha-bravo-charlie'

test('global search streams results and Enter opens the match', async ({ argus }) => {
  const { window } = argus

  await menuCommand(argus, 'global-search')
  const input = window.getByPlaceholder('Search in all files…')
  await input.fill(NEEDLE)

  const dialog = window.getByRole('dialog')
  await expect(dialog).toContainText('Found 2 results')
  await expect(dialog).toContainText('notes.md')
  await expect(dialog).toContainText('guide.md')

  await window.keyboard.press('Enter')
  await expect(dialog).not.toBeVisible()
  await expect(editorTab(window, 'notes.md').or(editorTab(window, 'guide.md'))).toBeVisible()
  // opened at the match's line
  await expect(window.getByRole('contentinfo')).toContainText('3:1')
})

test('case-sensitivity flag changes results', async ({ argus }) => {
  const { window } = argus

  await menuCommand(argus, 'global-search')
  const input = window.getByPlaceholder('Search in all files…')
  await input.fill(NEEDLE.toUpperCase())

  const dialog = window.getByRole('dialog')
  // insensitive by default: still 2 results
  await expect(dialog).toContainText('Found 2 results')

  await dialog.getByTitle('Case sensitive').click()
  await expect(dialog).toContainText('Found 0 results')
  await expect(dialog).toContainText('No results')
})

test('regex flag enables pattern search', async ({ argus }) => {
  const { window } = argus

  await menuCommand(argus, 'global-search')
  const input = window.getByPlaceholder('Search in all files…')
  await input.fill('alpha-\\w+-charlie')

  const dialog = window.getByRole('dialog')
  // literal mode: nothing matches the regex syntax
  await expect(dialog).toContainText('Found 0 results')

  await dialog.getByTitle('Regex').click()
  await expect(dialog).toContainText('Found 2 results')
})

test('a search pinned to the panel shows grouped results', async ({ argus }) => {
  const { window } = argus

  await menuCommand(argus, 'global-search')
  await window.getByPlaceholder('Search in all files…').fill(NEEDLE)
  const dialog = window.getByRole('dialog')
  await expect(dialog).toContainText('Found 2 results')

  await dialog.getByRole('button', { name: 'Open in Search Panel' }).click()
  await expect(dialog).not.toBeVisible()

  // bottom panel: one tab for the search, results grouped per file
  await expect(window.getByRole('button', { name: /docs\/notes\.md \(1\)/ })).toBeVisible()
  await expect(window.getByRole('button', { name: /docs\/guide\.md \(1\)/ })).toBeVisible()
  // the search tab header: pattern + result count
  await expect(window.getByRole('button', { name: new RegExp(`${NEEDLE} \\(2\\)`) })).toBeVisible()
})
