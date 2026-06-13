import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestApi, installTestApi, type TestApi } from '../../../test/apiAdapter'
import { type FixtureRepo, makeFixtureRepo, sampleProjectFiles } from '../../../test/fixtures'
import { useSearchStore } from './searchStore'
import { useWorkspaceStore } from './store'

const NEEDLE = 'alpha-bravo-charlie'

/** Search store streaming real ripgrep results through the api adapter. */
describe('search store (integration)', () => {
  let repo: FixtureRepo
  let testApi: TestApi

  beforeAll(async () => {
    repo = makeFixtureRepo({ files: sampleProjectFiles() })
    testApi = createTestApi(repo.root)
    installTestApi(testApi)
    await useWorkspaceStore.getState().init()
    await useSearchStore.getState().init()
  })

  afterAll(() => {
    testApi.dispose()
    repo.cleanup()
  })

  async function settledModal(): Promise<void> {
    await vi.waitFor(() => expect(useSearchStore.getState().modalResults.running).toBe(false), {
      timeout: 10_000
    })
  }

  it('modal search streams matches and completes', async () => {
    useSearchStore.getState().openModal(false)
    useSearchStore.getState().runModalSearch(NEEDLE)
    await settledModal()
    const results = useSearchStore.getState().modalResults
    expect(results.total).toBe(2)
    expect(results.matches.map((m) => m.path).sort()).toEqual(['docs/guide.md', 'docs/notes.md'])
    expect(results.matches[0].submatches[0]).toBeDefined()
  })

  it('clearing the pattern cancels and empties results', async () => {
    useSearchStore.getState().runModalSearch('')
    expect(useSearchStore.getState().modalResults).toMatchObject({ matches: [], running: false })
  })

  it('case-sensitivity flag changes modal results', async () => {
    useSearchStore.getState().runModalSearch(NEEDLE.toUpperCase())
    await settledModal()
    expect(useSearchStore.getState().modalResults.total).toBe(2) // insensitive

    useSearchStore.getState().setFlags({ caseSensitive: true })
    await settledModal()
    expect(useSearchStore.getState().modalResults.total).toBe(0)
    useSearchStore.getState().setFlags({ caseSensitive: false })
    await settledModal()
  })

  it('scoping the modal to a folder narrows results', async () => {
    useSearchStore.getState().runModalSearch(NEEDLE)
    await settledModal()
    useSearchStore.getState().setModalScope('src')
    await settledModal()
    expect(useSearchStore.getState().modalResults.total).toBe(0)
    useSearchStore.getState().setModalScope(null)
    await settledModal()
    expect(useSearchStore.getState().modalResults.total).toBe(2)
  })

  it('openInPanel pins the search to a tab and opens the bottom panel', async () => {
    useSearchStore.getState().runModalSearch(NEEDLE)
    await settledModal()
    useSearchStore.getState().openInPanel()

    const s = useSearchStore.getState()
    expect(s.modalOpen).toBe(false)
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0].pattern).toBe(NEEDLE)
    expect(useWorkspaceStore.getState().panels.bottomVisible).toBe(true)

    await vi.waitFor(
      () => {
        const tab = useSearchStore.getState().tabs[0]
        expect(tab.results.running).toBe(false)
        expect(tab.results.total).toBe(2)
      },
      { timeout: 10_000 }
    )
  })

  it('tab interactions: select match, collapse files, flag re-run', async () => {
    useSearchStore.getState().selectTabMatch(0, 1)
    expect(useSearchStore.getState().tabs[0].selectedMatch).toBe(1)

    useSearchStore.getState().toggleFileCollapsed(0, 'docs/notes.md')
    expect(useSearchStore.getState().tabs[0].collapsedFiles).toEqual(['docs/notes.md'])
    useSearchStore.getState().toggleFileCollapsed(0, 'docs/notes.md')
    expect(useSearchStore.getState().tabs[0].collapsedFiles).toEqual([])

    useSearchStore.getState().setTabFlags(0, { wholeWord: true })
    await vi.waitFor(() => expect(useSearchStore.getState().tabs[0].results.running).toBe(false), {
      timeout: 10_000
    })
    expect(useSearchStore.getState().tabs[0].flags.wholeWord).toBe(true)
    // selection reset by the re-run
    expect(useSearchStore.getState().tabs[0].selectedMatch).toBe(0)
  })

  it('persists tabs and options into the workspace state', async () => {
    await vi.waitFor(
      async () => {
        const stored = await testApi.api.loadWorkspaceState()
        expect(stored?.searchTabs).toEqual([
          {
            pattern: NEEDLE,
            caseSensitive: false,
            wholeWord: true,
            regex: false,
            scopeFolder: null
          }
        ])
        expect(stored?.lastSearchPattern).toBe(NEEDLE)
      },
      { timeout: 10_000 }
    )
  })

  it('closing tabs adjusts the active index and hides the panel when empty', async () => {
    // pin a second tab
    useSearchStore.getState().openModal(false)
    useSearchStore.getState().runModalSearch('needle-two')
    useSearchStore.getState().openInPanel()
    expect(useSearchStore.getState().tabs).toHaveLength(2)
    expect(useSearchStore.getState().activeTab).toBe(1)

    useSearchStore.getState().closeTab(0)
    expect(useSearchStore.getState().tabs).toHaveLength(1)
    expect(useSearchStore.getState().activeTab).toBe(0)

    useSearchStore.getState().closeAllTabs()
    expect(useSearchStore.getState().tabs).toEqual([])
    expect(useWorkspaceStore.getState().panels.bottomVisible).toBe(false)
  })

  it('results for an unknown searchId are ignored', () => {
    const before = useSearchStore.getState()
    testApi.emitSearchProgress(99999, {
      matches: [{ path: 'x.ts', line: 1, text: 'x', submatches: [], origSubmatches: [] }],
      done: true,
      total: 1,
      capped: false
    })
    expect(useSearchStore.getState().modalResults).toEqual(before.modalResults)
    expect(useSearchStore.getState().tabs).toEqual(before.tabs)
  })

  it('drops modal progress from a superseded query but keeps the current one', async () => {
    useSearchStore.getState().openModal(false)
    useSearchStore.getState().runModalSearch(NEEDLE)
    await settledModal()
    const currentId = useSearchStore.getState().modalSearchId
    const before = useSearchStore.getState().modalResults

    // a different modal id (older query, still in the <=0 modal space) is stale
    testApi.emitSearchProgress(currentId + 1, {
      matches: [{ path: 'stale.ts', line: 1, text: 'stale', submatches: [], origSubmatches: [] }],
      done: false,
      total: 1,
      capped: false
    })
    expect(useSearchStore.getState().modalResults).toEqual(before)

    // progress for the current id is still accepted
    testApi.emitSearchProgress(currentId, {
      matches: [{ path: 'fresh.ts', line: 1, text: 'fresh', submatches: [], origSubmatches: [] }],
      done: true,
      total: 3,
      capped: false
    })
    expect(useSearchStore.getState().modalResults.matches.some((m) => m.path === 'fresh.ts')).toBe(
      true
    )
  })
})
