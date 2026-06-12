import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApi, installTestApi, type TestApi } from '../../../../test/apiAdapter'
import { type FixtureRepo, makeFixtureRepo, sampleProjectFiles } from '../../../../test/fixtures'
import { useProcStore } from '../procStore'
import { useWorkspaceStore } from '../store'
import { useTasksStore } from '../tasksStore'
import { DefinitionPicker, shortenRubyPath } from './DefinitionPicker'
import { Highlighted, Modal, ModalRow } from './Modal'
import { ProjectsModal } from './ProjectsModal'
import { SlowOpsModal } from './SlowOpsModal'
import { StatusBar } from './StatusBar'
import { TitleBar } from './TitleBar'
import { Welcome } from './Welcome'

let repo: FixtureRepo
let testApi: TestApi

beforeAll(() => {
  repo = makeFixtureRepo({ files: sampleProjectFiles() })
  testApi = createTestApi(repo.root)
  installTestApi(testApi)
})

afterAll(() => {
  testApi.dispose()
  repo.cleanup()
})

describe('Welcome', () => {
  it('lists recent workspaces; open and remove call through the api', async () => {
    await testApi.api.openWorkspace(repo.root) // seeds the recents list
    const user = userEvent.setup()
    render(<Welcome />)

    const name = repo.root.split('/').pop() as string
    const entry = await screen.findByText(name)
    await user.click(entry)
    expect(testApi.calls.openedWorkspaces.filter((p) => p === repo.root).length).toBe(2)

    await user.click(screen.getByTitle('Remove from recent workspaces'))
    await waitFor(() => expect(screen.queryByText(name)).toBeNull())
    expect(await testApi.api.recentWorkspaces(5)).toEqual([])
  })

  it('always offers Open Folder', async () => {
    const user = userEvent.setup()
    render(<Welcome />)
    await user.click(screen.getByRole('button', { name: 'Open Folder…' }))
    expect(testApi.calls.openFolderDialogs).toBeGreaterThan(0)
  })
})

describe('TitleBar', () => {
  it('shows root name, branch, and in-progress git operations', () => {
    useWorkspaceStore.setState({
      rootName: 'my-project',
      gitState: { isRepo: true, branch: 'main', state: null }
    })
    const { rerender } = render(<TitleBar />)
    expect(screen.getByRole('banner')).toHaveTextContent('my-project')
    expect(screen.getByRole('banner')).toHaveTextContent('main')

    useWorkspaceStore.setState({ gitState: { isRepo: true, branch: 'main', state: 'rebasing' } })
    rerender(<TitleBar />)
    expect(screen.getByRole('banner')).toHaveTextContent('(Rebasing)')

    useWorkspaceStore.setState({ gitState: { isRepo: false, branch: null, state: null } })
    rerender(<TitleBar />)
    expect(screen.getByRole('banner')).not.toHaveTextContent('main')
  })
})

describe('StatusBar', () => {
  it('shows tasks, process stats, cursor, and language', async () => {
    useTasksStore.getState().init()
    useProcStore.getState().init()
    useWorkspaceStore.setState({ cursor: { line: 12, col: 5 }, language: 'Ruby' })
    testApi.emitTaskUpdate({ id: 7, status: 'started', name: 'Indexing project' })
    testApi.emitProcStats({
      at: Date.now(),
      entries: [
        {
          id: 1,
          pid: 123,
          kind: 'lsp',
          label: 'ruby-lsp (proj)',
          cpu: 12,
          memBytes: 256 * 1024 * 1024,
          childCount: 2,
          startedAt: Date.now() - 65_000
        }
      ],
      activity: [{ kind: 'git', totalCount: 4, count5m: 3, avgMs5m: 21, lastAt: Date.now() }],
      app: [{ type: 'main', pid: 1, cpu: 1.5, memBytes: 1024 * 1024 }],
      totals: { cpu: 12, memBytes: 256 * 1024 * 1024, count: 1 }
    })

    const user = userEvent.setup()
    render(<StatusBar />)
    expect(screen.getByText('Indexing project')).toBeInTheDocument()
    expect(screen.getByText('12:5')).toBeInTheDocument()
    expect(screen.getByText('Ruby')).toBeInTheDocument()

    // the proc summary button opens the breakdown popup
    await user.click(screen.getByText(/1 proc · 256 MB/))
    expect(screen.getByText('Language servers')).toBeInTheDocument()
    expect(screen.getByText('ruby-lsp (proj)')).toBeInTheDocument()
    expect(screen.getByText(/git ×3 avg 21ms/)).toBeInTheDocument()

    // clicking the cursor opens go-to-line
    await user.click(screen.getByText('12:5'))
    expect(useWorkspaceStore.getState().openModal).toBe('go-to-line')
    useWorkspaceStore.setState({ openModal: null })
  })
})

describe('Modal', () => {
  it('closes on Escape and on outside click, not on inner clicks', async () => {
    const user = userEvent.setup()
    let closed = 0
    const { container } = render(
      <Modal id="test" defaultWidth={400} defaultHeight={300} onClose={() => closed++}>
        <span>modal body</span>
      </Modal>
    )
    await user.click(screen.getByText('modal body'))
    expect(closed).toBe(0)

    await user.keyboard('{Escape}')
    expect(closed).toBe(1)

    const overlay = container.firstElementChild as HTMLElement
    await user.click(overlay)
    expect(closed).toBe(2)
  })

  it('ModalRow activates on double click; Highlighted marks indices', async () => {
    const user = userEvent.setup()
    let clicks = 0
    let activations = 0
    render(
      <ModalRow selected={false} onClick={() => clicks++} onActivate={() => activations++}>
        <Highlighted text="abc" indices={[1]} />
      </ModalRow>
    )
    await user.dblClick(screen.getByRole('button'))
    expect(clicks).toBeGreaterThan(0)
    expect(activations).toBe(1)
    // the matched character is emphasized
    expect(screen.getByText('b')).toHaveClass('text-accent')
    expect(screen.getByText('a')).not.toHaveClass('text-accent')
  })
})

describe('DefinitionPicker', () => {
  it('lists choices, navigates on Enter, closes on Escape', async () => {
    const user = userEvent.setup()
    const choices = [
      { path: 'src/lib/greet.ts', line: 0, character: 0 },
      { path: 'src/lib/math.ts', line: 4, character: 0 }
    ]
    useWorkspaceStore.setState({ definitionChoices: choices, rootPath: repo.root })
    render(<DefinitionPicker choices={choices} />)
    expect(screen.getByText('2 definitions')).toBeInTheDocument()

    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(useWorkspaceStore.getState().definitionChoices).toBeNull())
    const tabs = useWorkspaceStore.getState().tabs
    expect(tabs.tabs[tabs.activeIndex]?.path).toBe('src/lib/math.ts')
  })

  it('shortens ruby gem and stdlib paths', () => {
    expect(shortenRubyPath('/x/gems/activerecord-7.1.0/lib/active_record.rb')).toBe(
      '(activerecord-7.1.0) lib/active_record.rb'
    )
    expect(shortenRubyPath('/x/rubies/ruby-3.3.0/lib/set.rb')).toBe('(ruby 3.3.0) lib/set.rb')
    expect(shortenRubyPath('app/models/user.rb')).toBe('app/models/user.rb')
  })
})

describe('ProjectsModal & SlowOpsModal', () => {
  it('renders detected projects with badges', () => {
    useWorkspaceStore.setState({
      projects: [
        {
          root: `${repo.root}/engine`,
          relRoot: 'engine',
          kinds: ['ruby'],
          isRails: true,
          toolVersions: { ruby: '3.3.0' }
        }
      ]
    })
    render(<ProjectsModal />)
    expect(screen.getByText('Projects (1)')).toBeInTheDocument()
    expect(screen.getByText('engine')).toBeInTheDocument()
    expect(screen.getByText('Rails')).toBeInTheDocument()
    expect(screen.getByText('ruby 3.3.0')).toBeInTheDocument()
  })

  it('renders the slow-ops report (empty case)', async () => {
    render(<SlowOpsModal />)
    expect(await screen.findByText('No slow operations recorded this session.')).toBeVisible()
  })
})
