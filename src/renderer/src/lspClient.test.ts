import { diagnosticCount } from '@codemirror/lint'
import { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestApi, installTestApi, type TestApi } from '../../../test/apiAdapter'
import { type FixtureRepo, makeFixtureRepo, sampleProjectFiles } from '../../../test/fixtures'
import {
  applyDiagnosticsToView,
  diagnosticsFor,
  gotoDefinition,
  initLsp,
  isLspPath,
  requestDefinition
} from './lsp'
import { activeTabPath, documents, registerActiveView, useWorkspaceStore } from './store'

/** Renderer-side LSP glue, with the adapter's canned server responses. */
describe('renderer LSP client (spec 08)', () => {
  let repo: FixtureRepo
  let testApi: TestApi
  let view: EditorView

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
    initLsp()
    await useWorkspaceStore.getState().init()
  })

  afterAll(() => {
    view.destroy()
    registerActiveView(null)
    testApi.dispose()
    repo.cleanup()
  })

  it('classifies LSP-eligible paths', () => {
    expect(isLspPath('app/models/user.rb')).toBe(true)
    expect(isLspPath('Gemfile')).toBe(true)
    expect(isLspPath('src/app.tsx')).toBe(true)
    expect(isLspPath('README.md')).toBe(false)
    expect(isLspPath('styles.css')).toBe(false)
  })

  it('document lifecycle notifies the server', async () => {
    await useWorkspaceStore.getState().openFile('src/lib/greet.ts')
    expect(testApi.calls.lspDidOpen).toContain('src/lib/greet.ts')

    const doc = documents.get('src/lib/greet.ts')
    if (!doc) throw new Error('doc missing')
    documents.noteViewUpdate(
      'src/lib/greet.ts',
      doc.state.update({ changes: { from: 0, insert: '// x\n' } }).state,
      true
    )
    // change notifications are debounced inside the document manager
    await vi.waitFor(() => expect(testApi.calls.lspDidChange).toContain('src/lib/greet.ts'), {
      timeout: 5000
    })

    await useWorkspaceStore.getState().closeTabAt(0)
    expect(testApi.calls.lspDidClose).toContain('src/lib/greet.ts')

    // non-LSP files do not notify
    await useWorkspaceStore.getState().openFile('README.md')
    expect(testApi.calls.lspDidOpen).not.toContain('README.md')
    await useWorkspaceStore.getState().closeTabAt(0)
  })

  it('diagnostics land as CodeMirror lint markers on the active view', async () => {
    await useWorkspaceStore.getState().openFile('src/lib/math.ts')
    syncView()

    testApi.emitLspDiagnostics({
      path: 'src/lib/math.ts',
      diagnostics: [
        {
          startLine: 0,
          startChar: 0,
          endLine: 0,
          endChar: 6,
          severity: 1,
          message: 'first line is suspicious',
          source: 'fake'
        },
        // beyond the end of the doc: dropped during conversion
        {
          startLine: 9999,
          startChar: 0,
          endLine: 9999,
          endChar: 1,
          severity: 2,
          message: 'out of range',
          source: 'fake'
        }
      ]
    })

    expect(diagnosticsFor('src/lib/math.ts')).toHaveLength(2)
    expect(diagnosticCount(view.state)).toBe(1)
  })

  it('re-applies stored diagnostics to a fresh view', () => {
    const doc = documents.get('src/lib/math.ts')
    if (!doc) throw new Error('doc missing')
    const fresh = new EditorView()
    fresh.setState(doc.state)
    applyDiagnosticsToView(fresh, 'src/lib/math.ts')
    expect(diagnosticCount(fresh.state)).toBe(1)
    fresh.destroy()
  })

  it('projects pushed from main land in the workspace store', () => {
    testApi.emitLspProjects([
      { root: repo.root, relRoot: '.', kinds: ['javascript'], isRails: false, toolVersions: {} }
    ])
    expect(useWorkspaceStore.getState().projects).toHaveLength(1)
  })

  it('go to definition: no result shows a notice', async () => {
    await useWorkspaceStore.getState().openFile('src/lib/math.ts')
    syncView()
    testApi.lsp.definitions = []
    await gotoDefinition('definition')
    expect(useWorkspaceStore.getState().notice).toContain('No definition found')
  })

  it('go to definition: a single result navigates straight there', async () => {
    syncView()
    testApi.lsp.definitions = [{ path: 'src/lib/greet.ts', line: 0, character: 0 }]
    await gotoDefinition('definition')
    expect(activeTabPath()).toBe('src/lib/greet.ts')
  })

  it('go to definition: multiple results open the picker', async () => {
    syncView()
    testApi.lsp.definitions = [
      { path: 'src/lib/greet.ts', line: 0, character: 0 },
      { path: 'src/lib/math.ts', line: 4, character: 0 }
    ]
    await gotoDefinition('definition')
    expect(useWorkspaceStore.getState().definitionChoices).toHaveLength(2)
    useWorkspaceStore.setState({ definitionChoices: null })
  })

  it('requestDefinition is a no-op outside LSP files', async () => {
    await useWorkspaceStore.getState().openFile('README.md')
    expect(await requestDefinition('definition')).toEqual([])
  })
})
