import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestApi, installTestApi, type TestApi } from '../../../../test/apiAdapter'
import { type FixtureRepo, makeFixtureRepo, sampleProjectFiles } from '../../../../test/fixtures'
import { type SearchTab, useSearchStore } from '../searchStore'
import { activeTabPath, documents, useWorkspaceStore } from '../store'
import { SearchModal } from './SearchModal'
import { buildSegments, buildTreeRows, SearchPanel } from './SearchPanel'
import { SearchPreview } from './SearchPreview'

const NEEDLE = 'alpha-bravo-charlie'

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

async function modalSettled(): Promise<void> {
  await vi.waitFor(() => expect(useSearchStore.getState().modalResults.running).toBe(false), {
    timeout: 10_000
  })
}

describe('SearchModal (spec 03)', () => {
  it('streams results as you type; Enter opens the selected match', async () => {
    const user = userEvent.setup()
    useSearchStore.getState().openModal(false)
    render(<SearchModal />)

    await user.type(screen.getByPlaceholderText('Search in all files…'), NEEDLE)
    await modalSettled()
    expect(await screen.findByText('Found 2 results')).toBeInTheDocument()
    expect(screen.getByText('notes.md:3')).toBeInTheDocument()
    expect(screen.getByText('guide.md:3')).toBeInTheDocument()

    await user.keyboard('{Enter}')
    await waitFor(() => expect(useSearchStore.getState().modalOpen).toBe(false))
    expect(activeTabPath()).toMatch(/docs\//)
  })

  it('replace mode: replace-all rewrites files and reruns the search', async () => {
    const user = userEvent.setup()
    useSearchStore.getState().openModal(true)
    useSearchStore.getState().runModalSearch(NEEDLE)
    render(<SearchModal />)
    await modalSettled()

    // click-to-focus is unreliable in jsdom (zero-size rects trip the modal's
    // edge-resize handler), so focus the field directly before typing
    screen.getByPlaceholderText('Replace with…').focus()
    await user.keyboard('delta-echo')
    await user.click(screen.getByRole('button', { name: 'Replace All' }))

    expect(await screen.findByText('Replaced 2 occurrences in 2 files')).toBeInTheDocument()
    const onDisk = await testApi.api.readFile(repo.root, 'docs/notes.md')
    if (!onDisk.ok) throw new Error('read failed')
    expect(onDisk.content).toContain('delta-echo')
    expect(onDisk.content).not.toContain(NEEDLE)

    // restore the fixture content for later tests
    repo.write('docs/notes.md', `# Notes\n\nSearchable needle: ${NEEDLE}\n`)
    repo.write('docs/guide.md', `# Guide\n\nAnother needle: ${NEEDLE} appears here too.\n`)
    useSearchStore.getState().closeModal()
  })

  it('replace mode: single replace edits the buffer and drops the match', async () => {
    const user = userEvent.setup()
    useSearchStore.getState().openModal(true)
    useSearchStore.getState().runModalSearch(NEEDLE)
    render(<SearchModal />)
    await modalSettled()
    expect(useSearchStore.getState().modalResults.matches).toHaveLength(2)

    screen.getByPlaceholderText('Replace with…').focus()
    await user.keyboard('single-swap')
    await user.click(screen.getByRole('button', { name: /^Replace$/ }))

    await waitFor(() => {
      expect(useSearchStore.getState().modalResults.matches).toHaveLength(1)
    })
    // the edit went through the shared document buffer (autosave persists it)
    const edited = ['docs/guide.md', 'docs/notes.md'].find((p) =>
      documents.get(p)?.state.doc.toString().includes('single-swap')
    )
    expect(edited).toBeDefined()
    useSearchStore.getState().closeModal()

    // flush the dirty buffers (close saves), then restore the fixture so the
    // pending autosave can't clobber later tests
    await documents.close('docs/notes.md')
    await documents.close('docs/guide.md')
    repo.write('docs/notes.md', `# Notes\n\nSearchable needle: ${NEEDLE}\n`)
    repo.write('docs/guide.md', `# Guide\n\nAnother needle: ${NEEDLE} appears here too.\n`)
  })

  it('the scope row narrows the search to a folder', async () => {
    const user = userEvent.setup()
    useSearchStore.getState().openModal(false)
    useSearchStore.getState().runModalSearch('needle')
    render(<SearchModal />)
    await modalSettled()

    await user.click(screen.getByText(/Folder:/))
    screen.getByPlaceholderText('Filter folders…').focus()
    await user.keyboard('src{Enter}')
    await modalSettled()
    expect(useSearchStore.getState().modalScope).toBe('src')

    await user.click(screen.getByText('✕'))
    await modalSettled()
    expect(useSearchStore.getState().modalScope).toBeNull()
    useSearchStore.getState().closeModal()
  })
})

describe('SearchPanel (spec 03)', () => {
  it('shows the empty hint without tabs', () => {
    useSearchStore.setState({ tabs: [], activeTab: 0 })
    render(<SearchPanel />)
    expect(screen.getByText(/No searches yet/)).toBeInTheDocument()
  })

  it('renders grouped results; collapse and re-run work', async () => {
    const user = userEvent.setup()
    useSearchStore.getState().openModal(false)
    useSearchStore.getState().runModalSearch(NEEDLE)
    await modalSettled()
    useSearchStore.getState().openInPanel()
    await vi.waitFor(() => expect(useSearchStore.getState().tabs[0].results.running).toBe(false), {
      timeout: 10_000
    })

    render(<SearchPanel />)
    const groupHeader = (path: string): HTMLElement => {
      const header = screen
        .getAllByRole('button')
        .find((b) => b.textContent?.includes(path) && b.textContent.includes('('))
      if (!header) throw new Error(`no group header for ${path}`)
      return header
    }
    expect(groupHeader('docs/notes.md')).toBeInTheDocument()
    expect(groupHeader('docs/guide.md')).toBeInTheDocument()

    // collapsing a file group hides its match rows
    await user.click(groupHeader('docs/notes.md'))
    expect(useSearchStore.getState().tabs[0].collapsedFiles).toContain('docs/notes.md')

    // flag toggle reruns the search
    await user.click(screen.getByTitle('Case sensitive'))
    await vi.waitFor(() => expect(useSearchStore.getState().tabs[0].results.running).toBe(false), {
      timeout: 10_000
    })
    expect(useSearchStore.getState().tabs[0].flags.caseSensitive).toBe(true)

    useSearchStore.getState().closeAllTabs()
  })
})

describe('SearchPreview', () => {
  it('previews the selected match in a real editor over the shared buffer', async () => {
    const match = {
      path: 'src/lib/greet.ts',
      line: 2,
      text: '  return `Hello, ${name}!`',
      submatches: [{ start: 10, end: 15 }],
      origSubmatches: [{ start: 10, end: 15 }]
    }
    render(<SearchPreview match={match} />)
    expect(screen.getByText('src/lib/greet.ts')).toBeInTheDocument()
    await waitFor(() => {
      expect(documents.get('src/lib/greet.ts')).toBeDefined()
    })
  })

  it('prompts when nothing is selected', () => {
    render(<SearchPreview match={null} />)
    expect(screen.getByText('Select a match to preview it')).toBeInTheDocument()
  })
})

describe('pure helpers', () => {
  const tab = (matches: Array<{ path: string; line: number }>, collapsed: string[]): SearchTab => ({
    id: 1,
    pattern: 'x',
    flags: { caseSensitive: false, wholeWord: false, regex: false },
    scopeFolder: null,
    results: {
      matches: matches.map((m) => ({ ...m, text: 'x', submatches: [], origSubmatches: [] })),
      running: false,
      total: matches.length,
      capped: false
    },
    lazy: false,
    collapsedFiles: collapsed,
    selectedMatch: 0
  })

  it('buildTreeRows groups matches under file headers', () => {
    const rows = buildTreeRows(
      tab(
        [
          { path: 'a.ts', line: 1 },
          { path: 'a.ts', line: 5 },
          { path: 'b.ts', line: 2 }
        ],
        []
      )
    )
    expect(rows.map((r) => r.kind)).toEqual(['file', 'match', 'match', 'file', 'match'])
    expect(rows[0]).toMatchObject({ path: 'a.ts', count: 2 })
  })

  it('buildTreeRows hides matches of collapsed files', () => {
    const rows = buildTreeRows(
      tab(
        [
          { path: 'a.ts', line: 1 },
          { path: 'b.ts', line: 2 }
        ],
        ['a.ts']
      )
    )
    expect(rows.map((r) => r.kind)).toEqual(['file', 'file', 'match'])
  })

  it('buildSegments cuts syntax spans at match boundaries', () => {
    const segments = buildSegments(
      'const needle = 1',
      [{ from: 0, to: 5, className: 'tok-keyword' }],
      { start: 6, end: 12 }
    )
    expect(segments.map((s) => s.text)).toEqual(['const', ' ', 'needle', ' = 1'])
    expect(segments[0]).toMatchObject({ className: 'tok-keyword', matched: false })
    expect(segments[2]).toMatchObject({ matched: true })
  })
})
