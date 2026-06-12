import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestApi, installTestApi, type TestApi } from '../../../test/apiAdapter'
import { type FixtureRepo, makeFixtureRepo, sampleProjectFiles } from '../../../test/fixtures'
import { defaultWorkspaceState } from '../../shared/types'
import { useSearchStore } from './searchStore'
import { useWorkspaceStore } from './store'

/** Search tabs restored from persistence; only the active one re-runs. */
describe('search store restore', () => {
  let repo: FixtureRepo
  let testApi: TestApi

  beforeAll(async () => {
    repo = makeFixtureRepo({ files: sampleProjectFiles() })
    testApi = createTestApi(repo.root)
    installTestApi(testApi)
    await testApi.api.saveWorkspaceState({
      ...defaultWorkspaceState(),
      panels: { ...defaultWorkspaceState().panels, bottomVisible: true },
      searchTabs: [
        {
          pattern: 'needle-one',
          caseSensitive: false,
          wholeWord: false,
          regex: false,
          scopeFolder: null
        },
        {
          pattern: 'alpha-bravo-charlie',
          caseSensitive: true,
          wholeWord: false,
          regex: false,
          scopeFolder: 'docs'
        }
      ],
      activeSearchTab: 1,
      searchOptions: { caseSensitive: true, wholeWord: false, regex: false },
      lastSearchPattern: 'alpha-bravo-charlie'
    })
    await useWorkspaceStore.getState().init()
    await useSearchStore.getState().init()
  })

  afterAll(() => {
    testApi.dispose()
    repo.cleanup()
  })

  it('restores tabs lazily, re-running only the active one', async () => {
    const s = useSearchStore.getState()
    expect(s.tabs.map((t) => t.pattern)).toEqual(['needle-one', 'alpha-bravo-charlie'])
    expect(s.activeTab).toBe(1)
    expect(s.flags).toEqual({ caseSensitive: true, wholeWord: false, regex: false })
    expect(s.lastPattern).toBe('alpha-bravo-charlie')
    expect(s.tabs[0].lazy).toBe(true) // inactive tab waits for activation

    await vi.waitFor(
      () => {
        const active = useSearchStore.getState().tabs[1]
        expect(active.lazy).toBe(false)
        expect(active.results.running).toBe(false)
        expect(active.results.total).toBe(2)
        expect(active.results.matches.every((m) => m.path.startsWith('docs/'))).toBe(true)
      },
      { timeout: 10_000 }
    )
  })

  it('opening the modal prefills the last pattern and searches', async () => {
    useSearchStore.getState().openModal(false)
    expect(useSearchStore.getState().modalPattern).toBe('alpha-bravo-charlie')
    await vi.waitFor(() => expect(useSearchStore.getState().modalResults.running).toBe(false), {
      timeout: 10_000
    })
    expect(useSearchStore.getState().modalResults.total).toBe(2)
  })
})
