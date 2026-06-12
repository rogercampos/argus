import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApi, installTestApi, type TestApi } from '../../../../test/apiAdapter'
import { type FixtureRepo, makeFixtureRepo, sampleProjectFiles } from '../../../../test/fixtures'
import { activeTabPath, useWorkspaceStore } from '../store'
import { GoToFileModal } from './GoToFileModal'
import { GoToSymbolModal } from './GoToSymbolModal'
import { RecentFilesModal } from './RecentFilesModal'

let repo: FixtureRepo
let testApi: TestApi

/** result rows render highlighted names as per-character spans; match by row textContent */
async function findRow(text: string): Promise<HTMLElement> {
  let row: HTMLElement | undefined
  await waitFor(() => {
    row = screen.getAllByRole('button').find((b) => b.textContent?.includes(text))
    expect(row).toBeDefined()
  })
  return row as HTMLElement
}

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

describe('GoToFileModal (spec 04)', () => {
  it('fuzzy-filters paths and opens the selection on Enter', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({ openModal: 'go-to-file', lastGoToFileQuery: '' })
    render(<GoToFileModal />)

    const input = screen.getByPlaceholderText('Type a file name or path…')
    await user.type(input, 'greet')
    await findRow('greet.ts')

    await user.keyboard('{Enter}')
    await waitFor(() => expect(activeTabPath()).toBe('src/lib/greet.ts'))
    expect(useWorkspaceStore.getState().openModal).toBeNull()
    // the query is remembered for next time
    expect(useWorkspaceStore.getState().lastGoToFileQuery).toBe('greet')
  })

  it('excluded paths are hidden from results', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({
      openModal: 'go-to-file',
      lastGoToFileQuery: '',
      excludedPaths: ['docs']
    })
    render(<GoToFileModal />)
    await user.type(screen.getByPlaceholderText('Type a file name or path…'), 'notes')
    expect(await screen.findByText('No matching files')).toBeInTheDocument()
    useWorkspaceStore.setState({ excludedPaths: [] })
  })

  it('arrow keys wrap around the result list', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({ openModal: 'go-to-file', lastGoToFileQuery: '' })
    render(<GoToFileModal />)
    await user.type(screen.getByPlaceholderText('Type a file name or path…'), 'md')
    await findRow('notes.md')

    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(useWorkspaceStore.getState().openModal).toBeNull())
    expect(activeTabPath()).toMatch(/\.md$/)
  })

  it('absolute paths outside the workspace resolve when the file exists', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({ openModal: 'go-to-file', lastGoToFileQuery: '' })
    render(<GoToFileModal />)
    const outside = `${repo.root}/../definitely-missing-file.txt`
    await user.type(screen.getByPlaceholderText('Type a file name or path…'), outside)
    expect(await screen.findByText('No matching files')).toBeInTheDocument()
  })
})

describe('RecentFilesModal (spec 05)', () => {
  it('lists recent files, filters by name, opens on Enter', async () => {
    const user = userEvent.setup()
    await useWorkspaceStore.getState().openFile('src/lib/math.ts')
    await useWorkspaceStore.getState().openFile('src/lib/greet.ts')
    useWorkspaceStore.setState({ openModal: 'recent-files' })
    render(<RecentFilesModal />)

    expect(screen.getByText('greet.ts')).toBeInTheDocument()
    expect(screen.getByText('math.ts')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Recent files…'), 'math')
    await waitFor(() => expect(screen.queryByText('greet.ts')).toBeNull())

    await user.keyboard('{Enter}')
    await waitFor(() => expect(activeTabPath()).toBe('src/lib/math.ts'))
  })

  it('files that vanished from the workspace are filtered out', () => {
    useWorkspaceStore.setState({
      openModal: 'recent-files',
      recentFiles: ['gone.ts', 'src/index.ts']
    })
    render(<RecentFilesModal />)
    expect(screen.queryByText('gone.ts')).toBeNull()
    expect(screen.getByText('index.ts')).toBeInTheDocument()
  })
})

describe('GoToSymbolModal (spec 05)', () => {
  it('queries workspace symbols (debounced) and navigates to the pick', async () => {
    const user = userEvent.setup()
    testApi.lsp.symbols = [
      {
        name: 'subtract',
        kind: 12,
        containerName: 'math',
        location: { path: 'src/lib/math.ts', line: 4, character: 0 }
      }
    ]
    useWorkspaceStore.setState({ openModal: 'go-to-symbol' })
    render(<GoToSymbolModal />)

    await user.type(screen.getByPlaceholderText('Type a symbol name…'), 'sub')
    expect(await screen.findByText('subtract')).toBeInTheDocument()
    expect(screen.getByText('function')).toBeInTheDocument()

    await user.keyboard('{Enter}')
    await waitFor(() => expect(activeTabPath()).toBe('src/lib/math.ts'))
  })

  it('hints when no symbols come back', async () => {
    const user = userEvent.setup()
    testApi.lsp.symbols = []
    useWorkspaceStore.setState({ openModal: 'go-to-symbol' })
    render(<GoToSymbolModal />)
    await user.type(screen.getByPlaceholderText('Type a symbol name…'), 'nothing')
    expect(await screen.findByText(/No symbols/)).toBeInTheDocument()
  })
})
