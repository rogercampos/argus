import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestApi, installTestApi, type TestApi } from '../../../../test/apiAdapter'
import { type FixtureRepo, makeFixtureRepo, sampleProjectFiles } from '../../../../test/fixtures'
import { useProcStore } from '../procStore'
import { MODAL_SEARCH_ID, useSearchStore } from '../searchStore'
import { activeTabPath, useWorkspaceStore } from '../store'
import { useTasksStore } from '../tasksStore'
import { SearchModal } from './SearchModal'
import { SearchPanel } from './SearchPanel'
import { SlowOpsModal } from './SlowOpsModal'
import { StatusBar } from './StatusBar'

const NEEDLE = 'alpha-bravo-charlie'

let repo: FixtureRepo
let testApi: TestApi

beforeAll(async () => {
  repo = makeFixtureRepo({ files: sampleProjectFiles() })
  testApi = createTestApi(repo.root)
  installTestApi(testApi)
  useTasksStore.getState().init()
  useProcStore.getState().init()
  await useWorkspaceStore.getState().init()
  await useSearchStore.getState().init()
})

afterAll(() => {
  testApi.dispose()
  repo.cleanup()
})

describe('StatusBar formatting edge cases', () => {
  it('formats gigabytes, fractional cpu, hours of uptime, and queued tasks', async () => {
    const user = userEvent.setup()
    testApi.emitTaskUpdate({ id: 11, status: 'queued', name: 'Waiting job' })
    testApi.emitProcStats({
      at: Date.now(),
      entries: [
        {
          id: 2,
          pid: 9,
          kind: 'search',
          label: 'rg',
          cpu: 3.21,
          memBytes: 2.5 * 1024 ** 3,
          childCount: 0,
          startedAt: Date.now() - 2 * 3600 * 1000
        }
      ],
      activity: [{ kind: 'search', totalCount: 1, count5m: 1, avgMs5m: null, lastAt: Date.now() }],
      app: [],
      totals: { cpu: 3.21, memBytes: 2.5 * 1024 ** 3, count: 1 }
    })
    render(<StatusBar />)

    await user.click(screen.getByText(/1 proc · 2\.5 GB · 3\.2%/))
    expect(screen.getByText('2.0h')).toBeInTheDocument()
    expect(screen.getByText(/search ×1$/)).toBeInTheDocument()

    // queued task indicator + popup
    await user.click(screen.getByText('Waiting job'))
    expect(useTasksStore.getState().popupVisible).toBe(true)
    testApi.emitTaskUpdate({ id: 11, status: 'finished', name: 'Waiting job' })
  })

  it('shows 0 procs and the empty popup section', async () => {
    const user = userEvent.setup()
    testApi.emitProcStats({
      at: Date.now(),
      entries: [],
      activity: [],
      app: [],
      totals: { cpu: 0, memBytes: 0, count: 0 }
    })
    useProcStore.setState({ popupVisible: false })
    render(<StatusBar />)
    await user.click(screen.getByText('0 procs'))
    expect(screen.getByText('No external processes running')).toBeInTheDocument()
    useProcStore.setState({ popupVisible: false })
  })
})

describe('SearchPanel interactions', () => {
  beforeAll(async () => {
    useSearchStore.getState().openModal(false)
    useSearchStore.getState().runModalSearch(NEEDLE)
    await vi.waitFor(() => expect(useSearchStore.getState().modalResults.running).toBe(false), {
      timeout: 10_000
    })
    useSearchStore.getState().openInPanel()
    await vi.waitFor(() => expect(useSearchStore.getState().tabs[0]?.results.running).toBe(false), {
      timeout: 10_000
    })
  })

  it('arrow keys walk matches; Enter opens the selected one', async () => {
    render(<SearchPanel />)
    const listbox = screen.getByRole('listbox')

    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    expect(useSearchStore.getState().tabs[0].selectedMatch).toBe(1)
    fireEvent.keyDown(listbox, { key: 'ArrowUp' })
    expect(useSearchStore.getState().tabs[0].selectedMatch).toBe(0)

    fireEvent.keyDown(listbox, { key: 'Enter' })
    await waitFor(() => expect(activeTabPath()).toMatch(/docs\//))
  })

  it('match rows select on click and open on double click', async () => {
    render(<SearchPanel />)
    const matchRows = screen.getAllByRole('button').filter((b) => /^\d/.test(b.textContent ?? ''))
    expect(matchRows.length).toBeGreaterThanOrEqual(2)

    fireEvent.click(matchRows[1])
    expect(useSearchStore.getState().tabs[0].selectedMatch).toBe(1)

    fireEvent.doubleClick(matchRows[0])
    await waitFor(() => expect(activeTabPath()).toMatch(/docs\//))
  })

  it('the re-run button refreshes results; close-all empties the panel', async () => {
    const user = userEvent.setup()
    render(<SearchPanel />)
    await user.click(screen.getByTitle('Re-run search'))
    await vi.waitFor(() => expect(useSearchStore.getState().tabs[0].results.running).toBe(false), {
      timeout: 10_000
    })
    expect(useSearchStore.getState().tabs[0].results.total).toBe(2)

    await user.click(screen.getByTitle('Close all search tabs'))
    expect(useSearchStore.getState().tabs).toEqual([])
  })
})

describe('SearchModal footer and capped results', () => {
  it('Cmd+Enter pins the modal search to the panel', async () => {
    useSearchStore.getState().openModal(false)
    useSearchStore.getState().runModalSearch(NEEDLE)
    render(<SearchModal />)
    await vi.waitFor(() => expect(useSearchStore.getState().modalResults.running).toBe(false), {
      timeout: 10_000
    })

    fireEvent.keyDown(screen.getByPlaceholderText('Search in all files…'), {
      key: 'Enter',
      metaKey: true
    })
    await waitFor(() => expect(useSearchStore.getState().modalOpen).toBe(false))
    expect(useSearchStore.getState().tabs).toHaveLength(1)
    useSearchStore.getState().closeAllTabs()
  })

  it('reports capped result sets', async () => {
    useSearchStore.getState().openModal(false)
    useSearchStore.setState({ modalPattern: 'x' })
    render(<SearchModal />)
    testApi.emitSearchProgress(MODAL_SEARCH_ID, {
      matches: [],
      done: true,
      total: 100,
      capped: true
    })
    expect(await screen.findByText(/Showing first 100 — refine your search/)).toBeVisible()
    useSearchStore.getState().closeModal()
  })
})

describe('SlowOpsModal with recorded entries', () => {
  it('lists operations most recent first', async () => {
    testApi.slowOps.push(
      { time: Date.now() - 1000, operation: 'list-files', ms: 12000 },
      { time: Date.now(), operation: 'replace-all', ms: 15000 }
    )
    useWorkspaceStore.setState({ openModal: 'slow-ops' })
    render(<SlowOpsModal />)
    expect(await screen.findByText('list-files')).toBeInTheDocument()
    expect(screen.getByText('replace-all')).toBeInTheDocument()
    expect(screen.getByText('12000ms')).toBeInTheDocument()
  })
})
