import { editor, expect, openFileViaTree, test } from './helpers'

test('workspace window shows root name, branch, and the file tree', async ({ argus }) => {
  const { window, repo } = argus
  const rootName = repo.root.split('/').pop() as string

  await expect(window.getByRole('banner')).toContainText(rootName)
  await expect(window.getByRole('banner')).toContainText('main')

  for (const entry of ['README.md', 'package.json', 'src', 'docs']) {
    await expect(window.getByRole('treeitem', { name: entry })).toBeVisible()
  }
})

test('expanding folders and clicking a file opens it in the editor', async ({ argus }) => {
  const { window } = argus

  await openFileViaTree(window, 'src/lib/greet.ts')
  await expect(editor(window)).toContainText('export function greet')

  // status bar reflects the file's language; the cursor indicator appears
  // once a selection is made
  await expect(window.getByRole('contentinfo')).toContainText('TypeScript')
  await editor(window).click()
  await expect(window.getByRole('contentinfo')).toContainText(/\d+:\d+/)
})

test('empty workspace shows the editor placeholder', async ({ argus }) => {
  const { window } = argus
  await expect(window.getByText('Open a file from the tree')).toBeVisible()
})
