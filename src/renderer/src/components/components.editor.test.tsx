import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestApi, installTestApi, type TestApi } from '../../../../test/apiAdapter'
import { type FixtureRepo, makeFixtureRepo, sampleProjectFiles } from '../../../../test/fixtures'
import { activeTabPath, activeView, documents, useWorkspaceStore } from '../store'
import { EditorPane } from './EditorPane'
import { EditorTabs } from './EditorTabs'
import { GoToLineModal } from './GoToLineModal'
import { OpenTabsModal } from './OpenTabsModal'

let repo: FixtureRepo
let testApi: TestApi

beforeAll(async () => {
  repo = makeFixtureRepo({ files: sampleProjectFiles() })
  testApi = createTestApi(repo.root)
  installTestApi(testApi)
  await useWorkspaceStore.getState().init()
})

afterAll(() => {
  testApi.dispose()
  repo.cleanup()
})

describe('EditorPane', () => {
  it('shows a placeholder without tabs, then the real document', async () => {
    render(<EditorPane />)
    expect(screen.getByText(/Open a file from the tree/)).toBeInTheDocument()

    await useWorkspaceStore.getState().openFile('src/lib/greet.ts')
    await waitFor(() => {
      expect(activeView()?.state.doc.toString()).toContain('export function greet')
    })
    // the single persistent view swaps EditorStates on tab switches
    await useWorkspaceStore.getState().openFile('src/lib/math.ts')
    await waitFor(() => {
      expect(activeView()?.state.doc.toString()).toContain('export function subtract')
    })
  })

  it('restores the persisted cursor position on first open', async () => {
    render(<EditorPane />)
    await testApi.api.saveFileViewState('docs/notes.md', { cursorOffset: 9, scrollTop: 0 })
    await useWorkspaceStore.getState().openFile('docs/notes.md')
    await vi.waitFor(() => {
      expect(activeView()?.state.selection.main.head).toBe(9)
    })
  })
})

describe('EditorTabs', () => {
  it('renders tabs with dirty dots; click activates; × closes', async () => {
    const user = userEvent.setup()
    await useWorkspaceStore.getState().closeAllTabs()
    await useWorkspaceStore.getState().openFile('src/lib/greet.ts')
    await useWorkspaceStore.getState().openFile('src/lib/math.ts')
    render(<EditorTabs />)

    expect(screen.getByText('greet.ts')).toBeInTheDocument()
    expect(screen.getByText('math.ts')).toBeInTheDocument()

    await user.click(screen.getByText('greet.ts'))
    await waitFor(() => expect(activeTabPath()).toBe('src/lib/greet.ts'))

    // dirty dot appears on edit
    const doc = documents.get('src/lib/math.ts')
    if (!doc) throw new Error('doc missing')
    documents.noteViewUpdate(
      'src/lib/math.ts',
      doc.state.update({ changes: { from: 0, insert: '//\n' } }).state,
      true
    )
    await waitFor(() => {
      expect(document.querySelector('span.dot')).not.toBeNull()
    })

    const closeButtons = screen.getAllByTitle('Close tab')
    await user.click(closeButtons[0]) // closes greet.ts
    await waitFor(() => {
      expect(useWorkspaceStore.getState().tabs.tabs.map((t) => t.path)).toEqual(['src/lib/math.ts'])
    })
  })

  it('context menu offers close-others and close-all', async () => {
    const user = userEvent.setup()
    await useWorkspaceStore.getState().openFile('src/index.ts')
    render(<EditorTabs />)

    fireEvent.contextMenu(screen.getByText('index.ts'))
    expect(screen.getByText('Close Other Tabs')).toBeInTheDocument()

    await user.click(screen.getByText('Close All Tabs'))
    await waitFor(() => expect(useWorkspaceStore.getState().tabs.tabs).toEqual([]))
  })

  it('renders nothing without tabs', () => {
    const { container } = render(<EditorTabs />)
    expect(container.firstChild).toBeNull()
  })

  const paths = (): string[] => useWorkspaceStore.getState().tabs.tabs.map((t) => t.path)
  const openAll = async (...files: string[]): Promise<void> => {
    await useWorkspaceStore.getState().closeAllTabs()
    for (const f of files) await useWorkspaceStore.getState().openFile(f)
  }

  it('context menu closes to the right / left and disables what does not apply', async () => {
    const user = userEvent.setup()
    await openAll('README.md', 'src/index.ts', 'src/lib/greet.ts', 'src/lib/math.ts')
    render(<EditorTabs />)

    fireEvent.contextMenu(screen.getByText('greet.ts'))
    await user.click(screen.getByText('Close Tabs to the Right'))
    await waitFor(() => expect(paths()).toEqual(['README.md', 'src/index.ts', 'src/lib/greet.ts']))
    expect(activeTabPath()).toBe('src/lib/greet.ts')

    fireEvent.contextMenu(screen.getByText('README.md'))
    expect(screen.getByRole('menuitem', { name: /Close Tabs to the Left/ })).toBeDisabled()
    await user.click(screen.getByRole('menuitem', { name: /Close Tabs to the Right/ }))
    await waitFor(() => expect(paths()).toEqual(['README.md']))
  })

  it('pinned tabs survive bulk closes until unpinned', async () => {
    const user = userEvent.setup()
    await openAll('src/index.ts', 'src/lib/greet.ts', 'src/lib/math.ts')
    render(<EditorTabs />)

    fireEvent.contextMenu(screen.getByText('math.ts'))
    await user.click(screen.getByText('Pin Tab'))
    expect(paths()[0]).toBe('src/lib/math.ts')
    expect(screen.getByTitle('Unpin tab')).toBeInTheDocument()

    await useWorkspaceStore.getState().closeAllTabs()
    await waitFor(() => expect(paths()).toEqual(['src/lib/math.ts']))

    await user.click(screen.getByTitle('Unpin tab'))
    await useWorkspaceStore.getState().closeAllTabs()
    await waitFor(() => expect(paths()).toEqual([]))
  })

  it('reopen closed tab restores the most recently closed ones in order', async () => {
    await openAll('src/index.ts', 'src/lib/greet.ts')
    await useWorkspaceStore.getState().closeTabAt(1)
    await useWorkspaceStore.getState().closeTabAt(0)
    expect(paths()).toEqual([])

    await useWorkspaceStore.getState().reopenClosedTab()
    expect(paths()).toEqual(['src/index.ts'])
    await useWorkspaceStore.getState().reopenClosedTab()
    expect(paths()).toEqual(['src/index.ts', 'src/lib/greet.ts'])
    expect(activeTabPath()).toBe('src/lib/greet.ts')
  })

  it('tab list button opens the open-tabs list', async () => {
    const user = userEvent.setup()
    await openAll('src/index.ts', 'src/lib/greet.ts')
    render(<EditorTabs />)
    await user.click(screen.getByTitle(/Show all open tabs/))
    expect(useWorkspaceStore.getState().openModal).toBe('open-tabs')
    useWorkspaceStore.setState({ openModal: null })
  })
})

describe('OpenTabsModal', () => {
  const paths = (): string[] => useWorkspaceStore.getState().tabs.tabs.map((t) => t.path)

  it('filters, activates without reordering, and closes rows in place', async () => {
    const user = userEvent.setup()
    await useWorkspaceStore.getState().closeAllTabs()
    for (const f of ['README.md', 'src/index.ts', 'src/lib/greet.ts', 'src/lib/math.ts']) {
      await useWorkspaceStore.getState().openFile(f)
    }
    useWorkspaceStore.setState({ openModal: 'open-tabs' })
    render(<OpenTabsModal />)
    expect(screen.getByText('4 open tabs', { exact: false })).toBeInTheDocument()

    // close a row: the list stays open
    const row = screen.getAllByTitle(/^Close tab/)
    await user.click(row[0]) // README.md
    await waitFor(() => expect(paths()).not.toContain('README.md'))
    expect(useWorkspaceStore.getState().openModal).toBe('open-tabs')

    await user.type(screen.getByPlaceholderText('Filter open tabs…'), 'index')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(activeTabPath()).toBe('src/index.ts'))
    expect(paths()).toEqual(['src/index.ts', 'src/lib/greet.ts', 'src/lib/math.ts'])
    expect(useWorkspaceStore.getState().openModal).toBeNull()
  })

  it('header closes the tabs other than the highlighted one', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({ openModal: 'open-tabs' })
    render(<OpenTabsModal />)
    await user.type(screen.getByPlaceholderText('Filter open tabs…'), 'greet')
    await user.click(screen.getByRole('button', { name: 'Close Others' }))
    await waitFor(() => expect(paths()).toEqual(['src/lib/greet.ts']))
  })
})

describe('GoToLineModal', () => {
  it('jumps to line:column and records jump history', async () => {
    const user = userEvent.setup()
    await useWorkspaceStore.getState().openFile('src/lib/math.ts')
    render(
      <>
        <EditorPane />
        <GoToLineModal />
      </>
    )
    await waitFor(() => expect(activeView()?.state.doc.toString()).toContain('subtract'))
    // let the async persisted-cursor restore land before jumping, so it
    // cannot override the navigation below
    await new Promise((resolve) => setTimeout(resolve, 100))

    await user.type(screen.getByPlaceholderText('Line[:column]'), '2:3')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      const view = activeView()
      if (!view) throw new Error('no view')
      const line2 = view.state.doc.line(2)
      expect(view.state.selection.main.head).toBe(line2.from + 2)
    })
    expect(useWorkspaceStore.getState().openModal).toBeNull()
  })

  it('ignores invalid input', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({ openModal: 'go-to-line' })
    render(<GoToLineModal />)
    await user.type(screen.getByPlaceholderText('Line[:column]'), 'not-a-line')
    await user.click(screen.getByRole('button', { name: 'Go' }))
    expect(useWorkspaceStore.getState().openModal).toBeNull()
  })
})
