import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApi, installTestApi, type TestApi } from '../../../../test/apiAdapter'
import {
  type FixtureRepo,
  makeFixtureRepo,
  railsProjectFiles,
  sampleProjectFiles
} from '../../../../test/fixtures'
import { useSearchStore } from '../searchStore'
import { activeTabPath, activeView, documents, useWorkspaceStore } from '../store'
import { WorkspaceShell } from './WorkspaceShell'

let repo: FixtureRepo
let testApi: TestApi

beforeAll(() => {
  // a Rails-shaped repo that also contains the sample TS files
  repo = makeFixtureRepo({ files: { ...sampleProjectFiles(), ...railsProjectFiles() } })
  testApi = createTestApi(repo.root)
  installTestApi(testApi)
})

// the global afterEach unmounts everything, so each test gets a fresh shell
// (store init runs once — WorkspaceShell guards against double-init)
beforeEach(async () => {
  render(<WorkspaceShell />)
  await waitFor(() => expect(useWorkspaceStore.getState().loadingTree).toBe(false))
})

afterAll(() => {
  testApi.dispose()
  repo.cleanup()
})

describe('WorkspaceShell (spec 02)', () => {
  it('renders the full shell: title bar, sidebar header, editor placeholder, status bar', () => {
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByText(/Open a file from the tree/)).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    // the workspace name shows in the title bar AND the sidebar header
    const rootName = repo.root.split('/').pop() as string
    expect(screen.getAllByText(rootName).length).toBeGreaterThanOrEqual(2)
  })

  it('menu commands toggle the panels', async () => {
    expect(useWorkspaceStore.getState().panels.leftVisible).toBe(true)
    testApi.emitMenuCommand('toggle-file-tree')
    await waitFor(() => expect(useWorkspaceStore.getState().panels.leftVisible).toBe(false))
    testApi.emitMenuCommand('toggle-file-tree')
    await waitFor(() => expect(useWorkspaceStore.getState().panels.leftVisible).toBe(true))

    testApi.emitMenuCommand('toggle-search-panel')
    await waitFor(() => expect(useWorkspaceStore.getState().panels.bottomVisible).toBe(true))
    expect(screen.getByText(/No searches yet/)).toBeInTheDocument()
    testApi.emitMenuCommand('toggle-search-panel')
    await waitFor(() => expect(useWorkspaceStore.getState().panels.bottomVisible).toBe(false))
  })

  it('menu commands open and close the navigation modals', async () => {
    const user = userEvent.setup()
    const modals: Array<[string, string]> = [
      ['go-to-file', 'Type a file name or path…'],
      ['recent-files', 'Recent files…'],
      ['go-to-line', 'Line[:column]'],
      ['go-to-symbol', 'Type a symbol name…']
    ]
    for (const [command, placeholder] of modals) {
      testApi.emitMenuCommand(command as never)
      expect(await screen.findByPlaceholderText(placeholder)).toBeInTheDocument()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByPlaceholderText(placeholder)).toBeNull())
    }

    testApi.emitMenuCommand('show-projects')
    expect(await screen.findByText(/Projects \(/)).toBeInTheDocument()
    await user.keyboard('{Escape}')

    testApi.emitMenuCommand('show-slow-ops')
    expect(await screen.findByText(/Slow Operations/)).toBeInTheDocument()
    await user.keyboard('{Escape}')

    testApi.emitMenuCommand('global-search')
    expect(await screen.findByPlaceholderText('Search in all files…')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(useSearchStore.getState().modalOpen).toBe(false))

    testApi.emitMenuCommand('global-replace')
    expect(await screen.findByPlaceholderText('Replace with…')).toBeInTheDocument()
    await user.keyboard('{Escape}')
  })

  it('editor menu commands operate on the live CodeMirror view', async () => {
    await useWorkspaceStore.getState().openFile('src/lib/math.ts')
    await waitFor(() => expect(activeView()?.state.doc.toString()).toContain('subtract'))
    const view = activeView()
    if (!view) throw new Error('no view')
    const originalFirstLine = view.state.doc.line(1).text

    testApi.emitMenuCommand('duplicate-line')
    await waitFor(() => {
      expect(view.state.doc.line(2).text).toBe(originalFirstLine)
    })

    testApi.emitMenuCommand('move-line-down')
    await waitFor(() => {
      expect(view.state.doc.line(1).text).toBe(originalFirstLine) // the duplicate stayed
      expect(view.state.doc.line(3).text).toBe(originalFirstLine) // original moved down
    })

    testApi.emitMenuCommand('comment-line')
    await waitFor(() => {
      expect(view.state.doc.line(3).text).toBe(`// ${originalFirstLine}`)
    })

    // save flushes the dirty buffer to disk
    testApi.emitMenuCommand('save')
    await vi.waitFor(async () => {
      const onDisk = await testApi.api.readFile(repo.root, 'src/lib/math.ts')
      if (!onDisk.ok) throw new Error('read failed')
      expect(onDisk.content).toContain(`// ${originalFirstLine}`)
      expect(useWorkspaceStore.getState().dirtyPaths['src/lib/math.ts']).toBe(false)
    })
  })

  it('tab menu commands cycle and close tabs', async () => {
    await useWorkspaceStore.getState().openFile('src/lib/greet.ts')
    expect(activeTabPath()).toBe('src/lib/greet.ts')

    testApi.emitMenuCommand('previous-tab')
    await waitFor(() => expect(activeTabPath()).toBe('src/lib/math.ts'))
    testApi.emitMenuCommand('next-tab')
    await waitFor(() => expect(activeTabPath()).toBe('src/lib/greet.ts'))

    testApi.emitMenuCommand('close-tab')
    await waitFor(() => expect(activeTabPath()).toBe('src/lib/math.ts'))
  })

  it('save-all flushes every dirty buffer', async () => {
    await useWorkspaceStore.getState().openFile('src/index.ts')
    const doc = documents.get('src/index.ts')
    if (!doc) throw new Error('doc missing')
    documents.noteViewUpdate(
      'src/index.ts',
      doc.state.update({ changes: { from: 0, insert: '// dirty\n' } }).state,
      true
    )
    testApi.emitMenuCommand('save-all')
    await vi.waitFor(async () => {
      const onDisk = await testApi.api.readFile(repo.root, 'src/index.ts')
      if (!onDisk.ok) throw new Error('read failed')
      expect(onDisk.content.startsWith('// dirty')).toBe(true)
    })
  })

  it('opening a Rails model loads its schema and shows the right panel', async () => {
    await useWorkspaceStore.getState().openFile('app/models/user.rb')
    await waitFor(() => {
      expect(useWorkspaceStore.getState().schemaInfo?.table).toBe('users')
      expect(useWorkspaceStore.getState().panels.rightVisible).toBe(true)
    })
    expect(screen.getByText(/Columns \(/)).toBeInTheDocument()
    expect(screen.getAllByText('email').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('UNIQUE')).toBeInTheDocument()

    // leaving the model closes the panel again
    await useWorkspaceStore.getState().openFile('src/lib/math.ts')
    await waitFor(() => {
      expect(useWorkspaceStore.getState().schemaInfo).toBeNull()
      expect(useWorkspaceStore.getState().panels.rightVisible).toBe(false)
    })
  })

  it('schema panel rows navigate into db/schema.rb', async () => {
    const user = userEvent.setup()
    await useWorkspaceStore.getState().openFile('app/models/user.rb')
    await waitFor(() => expect(useWorkspaceStore.getState().panels.rightVisible).toBe(true))

    // schema rows carry an "Open db/schema.rb:<line>" tooltip
    await user.click(screen.getAllByTitle(/Open db\/schema\.rb:/)[0])
    await waitFor(() => expect(activeTabPath()).toBe('db/schema.rb'))
  })

  it('notices and file errors render and dismiss', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.getState().showNotice('Something transient')
    expect(await screen.findByText('Something transient')).toBeInTheDocument()

    useWorkspaceStore.setState({ fileError: 'big.bin: cannot open' })
    const error = await screen.findByText(/big\.bin: cannot open/)
    await user.click(error)
    await waitFor(() => expect(useWorkspaceStore.getState().fileError).toBeNull())
  })

  it('find opens the in-editor search panel on the live view', async () => {
    await useWorkspaceStore.getState().openFile('src/lib/math.ts')
    await waitFor(() => expect(activeView()).not.toBeNull())
    testApi.emitMenuCommand('find')
    await waitFor(() => expect(document.querySelector('.cm-search')).not.toBeNull())
    testApi.emitMenuCommand('replace')
    expect(document.querySelector('.cm-search')).not.toBeNull()
  })

  it('jump back and forward retrace navigation', async () => {
    await useWorkspaceStore.getState().navigateTo('src/lib/math.ts', { line: 1 })
    await useWorkspaceStore.getState().navigateTo('src/lib/greet.ts', { line: 1 })
    testApi.emitMenuCommand('jump-back')
    await waitFor(() => expect(activeTabPath()).toBe('src/lib/math.ts'))
    testApi.emitMenuCommand('jump-forward')
    await waitFor(() => expect(activeTabPath()).toBe('src/lib/greet.ts'))
  })

  it('copy-relative-path puts the active tab path on the clipboard', async () => {
    await useWorkspaceStore.getState().openFile('src/lib/math.ts')
    const writes: string[] = []
    // userEvent may have swapped the clipboard stub; intercept whatever is there
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string): Promise<void> => {
          writes.push(text)
          return Promise.resolve()
        }
      }
    })
    testApi.emitMenuCommand('copy-relative-path')
    await waitFor(() => expect(writes).toContain('src/lib/math.ts'))
  })

  it('unhandled commands are ignored without crashing', async () => {
    testApi.emitMenuCommand('toggle-inlay-hints')
    testApi.emitMenuCommand('format-document')
    testApi.emitMenuCommand('new-file')
  })

  it('go-to-definition with multiple results opens the picker', async () => {
    await useWorkspaceStore.getState().openFile('src/lib/math.ts')
    testApi.lsp.definitions = [
      { path: 'src/lib/greet.ts', line: 0, character: 0 },
      { path: 'src/index.ts', line: 0, character: 0 }
    ]
    testApi.emitMenuCommand('go-to-definition')
    expect(await screen.findByText('2 definitions')).toBeInTheDocument()
    useWorkspaceStore.setState({ definitionChoices: null })
  })
})
