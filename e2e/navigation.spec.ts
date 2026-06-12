import { editor, expect, menuCommand, openFileViaTree, test } from './helpers'

test('go to line jumps the cursor', async ({ argus }) => {
  const { window } = argus

  await openFileViaTree(window, 'src/lib/math.ts')
  await menuCommand(argus, 'go-to-line')

  const input = window.getByPlaceholder('Line[:column]')
  await input.fill('5')
  await window.keyboard.press('Enter')

  await expect(window.getByRole('contentinfo')).toContainText('5:1')
})

test('go to line accepts line:column and clamps out-of-range lines', async ({ argus }) => {
  const { window } = argus

  await openFileViaTree(window, 'src/lib/math.ts')
  await menuCommand(argus, 'go-to-line')
  await window.getByPlaceholder('Line[:column]').fill('2:8')
  await window.keyboard.press('Enter')
  await expect(window.getByRole('contentinfo')).toContainText('2:8')

  // way past the end: clamps to the last line instead of erroring
  await menuCommand(argus, 'go-to-line')
  await window.getByPlaceholder('Line[:column]').fill('9999')
  await window.keyboard.press('Enter')
  await expect(window.getByRole('contentinfo')).toContainText('8:1')
})

test('jump back / forward retrace navigation history', async ({ argus }) => {
  const { window } = argus

  // both files opened through navigateTo (records jump history)
  await menuCommand(argus, 'go-to-file')
  await window.getByPlaceholder('Type a file name or path…').fill('math')
  await window.keyboard.press('Enter')
  await expect(editor(window)).toContainText('export function subtract')

  await menuCommand(argus, 'go-to-file')
  await window.getByPlaceholder('Type a file name or path…').fill('greet')
  await window.keyboard.press('Enter')
  await expect(editor(window)).toContainText('export function greet')

  await menuCommand(argus, 'jump-back')
  await expect(editor(window)).toContainText('export function subtract')

  await menuCommand(argus, 'jump-forward')
  await expect(editor(window)).toContainText('export function greet')
})
