import { expect, menuCommand, openFileViaTree, test } from './helpers'

test('find opens the in-editor search panel and highlights matches', async ({ argus }) => {
  const { window } = argus

  await openFileViaTree(window, 'src/lib/math.ts')
  await menuCommand(argus, 'find')

  // CodeMirror's search panel
  const panel = window.locator('.cm-search')
  await expect(panel).toBeVisible()

  // real key events: CodeMirror's panel reads them to update the query
  await panel.locator('input[name="search"]').pressSequentially('subtract')

  // jump to the match: cursor lands on the line declaring subtract (line 5)
  await window.keyboard.press('Enter')
  await expect(window.getByRole('contentinfo')).toContainText('5:')
})
