import { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestApi, installTestApi, type TestApi } from '../../../test/apiAdapter'
import { type FixtureRepo, makeFixtureRepo, sampleProjectFiles } from '../../../test/fixtures'
import {
  activeTabPath,
  documents,
  isExternalPath,
  languageForPath,
  registerActiveView,
  useWorkspaceStore
} from './store'
import { MAX_OPEN_TABS } from './tabs'

/**
 * The workspace store against the real backend modules (fixture repo on disk,
 * real DocumentManager); only the IPC wire is absent (test/apiAdapter.ts).
 */
describe('workspace store (integration)', () => {
  let repo: FixtureRepo
  let testApi: TestApi
  let view: EditorView

  /** mimic EditorPane: keep one view showing the active document */
  function syncView(): void {
    const path = activeTabPath()
    const doc = path ? documents.get(path) : undefined
    if (doc) view.setState(doc.state)
  }

  beforeAll(async () => {
    repo = makeFixtureRepo({ files: sampleProjectFiles() })
    testApi = createTestApi(repo.root)
    installTestApi(testApi)
    view = new EditorView()
    registerActiveView(view)
    await useWorkspaceStore.getState().init()
  })

  afterAll(() => {
    view.destroy()
    registerActiveView(null)
    testApi.dispose()
    repo.cleanup()
  })

  it('init loads the workspace: root, full path list, watching', () => {
    const s = useWorkspaceStore.getState()
    expect(s.rootPath).toBe(repo.root)
    expect(s.rootName).toBe(repo.root.split('/').pop())
    expect(s.paths).toContain('src/lib/greet.ts')
    expect(s.loadingTree).toBe(false)
    expect(testApi.calls.watchStarts).toBe(1)
  })

  it('openFile loads the document, adds a tab, and tracks recency', async () => {
    await useWorkspaceStore.getState().openFile('src/lib/greet.ts')
    const s = useWorkspaceStore.getState()
    expect(activeTabPath()).toBe('src/lib/greet.ts')
    expect(s.language).toBe('TypeScript')
    expect(s.recentFiles[0]).toBe('src/lib/greet.ts')
    expect(documents.get('src/lib/greet.ts')?.state.doc.toString()).toContain(
      'export function greet'
    )
    expect(s.fileError).toBeNull()
  })

  it('openFile without intent does not touch recency', async () => {
    const before = useWorkspaceStore.getState().recentFiles
    await useWorkspaceStore.getState().openFile('src/lib/math.ts', { intent: false })
    expect(useWorkspaceStore.getState().recentFiles).toEqual(before)
  })

  it('unreadable files surface a fileError instead of a tab', async () => {
    repo.write('image.bin', Buffer.from([0x89, 0x00, 0x50]))
    const tabsBefore = useWorkspaceStore.getState().tabs.tabs.length
    await useWorkspaceStore.getState().openFile('image.bin')
    const s = useWorkspaceStore.getState()
    expect(s.fileError).toContain('image.bin')
    expect(s.tabs.tabs.length).toBe(tabsBefore)
  })

  it('tab management: activate, cycle, close with successor rules', async () => {
    await useWorkspaceStore.getState().openFile('src/index.ts')
    // tabs now: greet.ts, math.ts, index.ts (active 2)
    expect(useWorkspaceStore.getState().tabs.tabs.map((t) => t.path)).toEqual([
      'src/lib/greet.ts',
      'src/lib/math.ts',
      'src/index.ts'
    ])

    await useWorkspaceStore.getState().activateTab(0)
    expect(activeTabPath()).toBe('src/lib/greet.ts')

    await useWorkspaceStore.getState().cycleTabs(1)
    expect(activeTabPath()).toBe('src/lib/math.ts')
    await useWorkspaceStore.getState().cycleTabs(-1)
    expect(activeTabPath()).toBe('src/lib/greet.ts')

    await useWorkspaceStore.getState().closeTabAt(0)
    expect(useWorkspaceStore.getState().tabs.tabs.map((t) => t.path)).toEqual([
      'src/lib/math.ts',
      'src/index.ts'
    ])
    expect(documents.get('src/lib/greet.ts')).toBeUndefined()

    await useWorkspaceStore.getState().closeOthers(1)
    expect(useWorkspaceStore.getState().tabs.tabs.map((t) => t.path)).toEqual(['src/index.ts'])

    await useWorkspaceStore.getState().closeAllTabs()
    expect(useWorkspaceStore.getState().tabs.tabs).toEqual([])
    expect(useWorkspaceStore.getState().language).toBeNull()
  })

  it('navigateTo positions the cursor by line and column', async () => {
    await useWorkspaceStore.getState().openFile('src/lib/math.ts')
    syncView()
    await useWorkspaceStore.getState().navigateTo('src/lib/math.ts', { line: 5, col: 8 })
    const line5 = view.state.doc.line(5)
    expect(view.state.selection.main.head).toBe(line5.from + 7)

    // clamped: line beyond the end goes to the last line
    await useWorkspaceStore.getState().navigateTo('src/lib/math.ts', { line: 9999 })
    expect(view.state.selection.main.head).toBe(view.state.doc.line(view.state.doc.lines).from)
  })

  it('jump history retraces deliberate navigation', async () => {
    syncView()
    await useWorkspaceStore.getState().navigateTo('src/lib/greet.ts', { line: 1 })
    syncView()
    expect(activeTabPath()).toBe('src/lib/greet.ts')

    await useWorkspaceStore.getState().jumpBack()
    expect(activeTabPath()).toBe('src/lib/math.ts')

    await useWorkspaceStore.getState().jumpForward()
    expect(activeTabPath()).toBe('src/lib/greet.ts')
  })

  it('edits autosave through the document manager to disk', async () => {
    const path = 'src/lib/greet.ts'
    await useWorkspaceStore.getState().openFile(path)
    const doc = documents.get(path)
    if (!doc) throw new Error('doc not open')

    const edited = doc.state.update({
      changes: { from: 0, insert: '// autosaved edit\n' }
    }).state
    documents.noteViewUpdate(path, edited, true)
    expect(useWorkspaceStore.getState().dirtyPaths[path]).toBe(true)

    // autosave fires AUTOSAVE_DELAY_MS (700ms) after the last edit
    await vi.waitFor(
      async () => {
        const onDisk = await testApi.api.readFile(repo.root, path)
        expect(onDisk).toMatchObject({ ok: true })
        if (onDisk.ok) expect(onDisk.content.startsWith('// autosaved edit')).toBe(true)
        expect(useWorkspaceStore.getState().dirtyPaths[path]).toBe(false)
      },
      { timeout: 5000 }
    )
  })

  it('git state and status diffs update the store incrementally', () => {
    testApi.emitGitState({ isRepo: true, branch: 'feature', state: 'rebasing' })
    expect(useWorkspaceStore.getState().gitState.branch).toBe('feature')

    testApi.emitGitStatusDiff({ 'a.ts': 'modified', 'b.ts': 'untracked' })
    testApi.emitGitStatusDiff({ 'a.ts': null, 'c.ts': 'added' })
    expect(useWorkspaceStore.getState().gitStatus).toEqual([
      { path: 'b.ts', status: 'untracked' },
      { path: 'c.ts', status: 'added' }
    ])
  })

  it('watch events relist the tree (debounced) and reload open documents', async () => {
    repo.write('appeared-later.ts', 'export const later = 1\n')
    testApi.emitWatchEvents([{ type: 'create', relPath: 'appeared-later.ts' }])
    await vi.waitFor(
      () => expect(useWorkspaceStore.getState().paths).toContain('appeared-later.ts'),
      { timeout: 5000 }
    )

    // update to an open, clean document: content reloads, epoch bumps
    const path = 'src/lib/greet.ts'
    await useWorkspaceStore.getState().openFile(path)
    const epochBefore = useWorkspaceStore.getState().activeDocEpoch
    repo.write(path, 'export const reloaded = true\n')
    testApi.emitWatchEvents([{ type: 'update', relPath: path }])
    await vi.waitFor(
      () => {
        expect(documents.get(path)?.state.doc.toString()).toBe('export const reloaded = true\n')
        expect(useWorkspaceStore.getState().activeDocEpoch).toBeGreaterThan(epochBefore)
      },
      { timeout: 5000 }
    )
  })

  it('persists panels, tabs, and recents on the debounce', async () => {
    useWorkspaceStore.getState().setPanels({ leftWidth: 321, bottomVisible: true })
    await vi.waitFor(
      async () => {
        const stored = await testApi.api.loadWorkspaceState()
        expect(stored?.panels.leftWidth).toBe(321)
        expect(stored?.editor.openTabs.map((t) => t.path)).toContain('src/lib/greet.ts')
        expect(stored?.recentFiles[0]).toBe('src/lib/greet.ts')
      },
      { timeout: 5000 }
    )
  })

  it('notices auto-dismiss', async () => {
    useWorkspaceStore.getState().showNotice('No definition found')
    expect(useWorkspaceStore.getState().notice).toBe('No definition found')
    await vi.waitFor(() => expect(useWorkspaceStore.getState().notice).toBeNull(), {
      timeout: 5000
    })
  })

  it('evicts the least-recent tab over the cap', async () => {
    await useWorkspaceStore.getState().closeAllTabs()
    for (let i = 0; i < MAX_OPEN_TABS + 1; i++) {
      repo.write(`bulk/file-${String(i).padStart(2, '0')}.ts`, `export const v = ${i}\n`)
      await useWorkspaceStore.getState().openFile(`bulk/file-${String(i).padStart(2, '0')}.ts`)
    }
    const s = useWorkspaceStore.getState()
    expect(s.tabs.tabs.length).toBe(MAX_OPEN_TABS)
    // the least recently used tab (the first one opened) was evicted
    expect(s.tabs.tabs.map((t) => t.path)).not.toContain('bulk/file-00.ts')
    expect(documents.get('bulk/file-00.ts')).toBeUndefined()
  })

  it('pure helpers: language detection and external paths', () => {
    expect(languageForPath('Gemfile')).toBe('Ruby')
    expect(languageForPath('Dockerfile')).toBe('Docker')
    expect(languageForPath('a/b.tsx')).toBe('TypeScript')
    expect(languageForPath('a/b.unknownext')).toBeNull()
    expect(isExternalPath('/abs/path.rb')).toBe(true)
    expect(isExternalPath('node_modules/x/y.js')).toBe(true)
    expect(isExternalPath('src/app.ts')).toBe(false)
  })
})
