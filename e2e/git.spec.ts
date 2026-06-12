import { expect, test } from './helpers'

test('title bar tracks the current branch', async ({ argus }) => {
  const { window, repo } = argus

  const banner = window.getByRole('banner')
  await expect(banner).toContainText('main')

  repo.git('checkout', '-b', 'feature/coverage')
  await expect(banner).toContainText('feature/coverage')

  repo.git('checkout', 'main')
  await expect(banner).toContainText('main')
  await expect(banner).not.toContainText('feature/coverage')
})
