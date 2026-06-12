import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApi, installTestApi, type TestApi } from '../../../test/apiAdapter'
import { type FixtureRepo, makeFixtureRepo, sampleProjectFiles } from '../../../test/fixtures'
import { defaultWorkspaceState } from '../../shared/types'
import { activeTabPath, useWorkspaceStore } from './store'

/** init() with previously persisted state (fresh module registry per file). */
describe('workspace store session restore', () => {
  let repo: FixtureRepo
  let testApi: TestApi

  beforeAll(async () => {
    repo = makeFixtureRepo({ files: sampleProjectFiles() })
    testApi = createTestApi(repo.root)
    installTestApi(testApi)

    await testApi.api.saveWorkspaceState({
      ...defaultWorkspaceState(),
      panels: { ...defaultWorkspaceState().panels, leftVisible: false, leftWidth: 432 },
      recentFiles: ['src/lib/math.ts'],
      starredFolders: ['src'],
      excludedPaths: ['docs'],
      editor: {
        openTabs: [
          { path: 'src/lib/math.ts' },
          { path: 'vanished.ts' }, // no longer on disk: dropped on restore
          { path: 'src/lib/greet.ts' }
        ],
        activeTab: 2
      }
    })
    await useWorkspaceStore.getState().init()
  })

  afterAll(() => {
    testApi.dispose()
    repo.cleanup()
  })

  it('restores panels, recents, stars, and exclusions', () => {
    const s = useWorkspaceStore.getState()
    expect(s.panels.leftVisible).toBe(false)
    expect(s.panels.leftWidth).toBe(432)
    expect(s.recentFiles).toEqual(['src/lib/math.ts'])
    expect(s.starredFolders).toEqual(['src'])
    expect(s.excludedPaths).toEqual(['docs'])
  })

  it('restores tabs, dropping files that vanished, keeping the active tab', () => {
    const s = useWorkspaceStore.getState()
    expect(s.tabs.tabs.map((t) => t.path)).toEqual(['src/lib/math.ts', 'src/lib/greet.ts'])
    // activeTab index 2 pointed at greet.ts; after the drop it clamps to it
    expect(activeTabPath()).toBe('src/lib/greet.ts')
    expect(s.language).toBe('TypeScript')
  })
})
