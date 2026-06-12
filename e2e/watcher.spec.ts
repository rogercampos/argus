import { editor, expect, openFileViaTree, test } from './helpers'

test('files created and deleted on disk appear/disappear in the tree', async ({ argus }) => {
  const { window, repo } = argus

  // expand src first so the new entry is visible when it lands
  await window.getByRole('treeitem', { name: 'src' }).click()
  await expect(window.getByRole('treeitem', { name: 'index.ts' })).toBeVisible()

  repo.write('src/created-by-watcher.ts', 'export const fresh = true\n')
  await expect(window.getByRole('treeitem', { name: 'created-by-watcher.ts' })).toBeVisible()

  repo.rm('src/created-by-watcher.ts')
  await expect(window.getByRole('treeitem', { name: 'created-by-watcher.ts' })).not.toBeVisible()
})

test('external changes to an open, clean file reload the editor', async ({ argus }) => {
  const { window, repo } = argus

  await openFileViaTree(window, 'src/lib/greet.ts')
  await expect(editor(window)).toContainText('export function greet')

  repo.write('src/lib/greet.ts', 'export const replacedExternally = 1\n')
  await expect(editor(window)).toContainText('replacedExternally')
})
