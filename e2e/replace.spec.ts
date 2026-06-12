import { expect, expectFileOnDisk, menuCommand, test } from './helpers'

test('replace all rewrites every match on disk', async ({ argus }) => {
  const { window, repo } = argus

  await menuCommand(argus, 'global-replace')
  const dialog = window.getByRole('dialog')
  await dialog.getByPlaceholder('Search in all files…').fill('alpha-bravo-charlie')
  await expect(dialog).toContainText('Found 2 results')

  await dialog.getByPlaceholder('Replace with…').fill('delta-echo-foxtrot')
  await dialog.getByRole('button', { name: 'Replace All' }).click()

  await expect(dialog).toContainText('Replaced 2 occurrences in 2 files')
  await expectFileOnDisk(repo, 'docs/notes.md', (c) => c.includes('delta-echo-foxtrot'))
  await expectFileOnDisk(repo, 'docs/guide.md', (c) => c.includes('delta-echo-foxtrot'))
  await expectFileOnDisk(repo, 'docs/notes.md', (c) => !c.includes('alpha-bravo-charlie'))

  // the search re-runs against the new contents
  await expect(dialog).toContainText('No results')
})
