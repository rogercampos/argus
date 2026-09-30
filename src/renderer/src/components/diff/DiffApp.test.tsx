import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApi, installTestApi, type TestApi } from '../../../../../test/apiAdapter'
import { type FixtureRepo, makeFixtureRepo } from '../../../../../test/fixtures'
import { useDiffStore } from '../../diffStore'
import { DiffApp } from './DiffApp'

/**
 * The diff window against a real repo through the real git-backed diff
 * module (only the IPC hop is skipped).
 */

// jsdom has no IntersectionObserver: report every card as on screen at once
class ImmediateIntersectionObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element): void {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    )
  }
  disconnect(): void {}
  unobserve(): void {}
}
;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
  ImmediateIntersectionObserver
// …nor element scrolling (jumping to a file scrolls the diff column)
Element.prototype.scrollTo ??= () => {}

let repo: FixtureRepo
let testApi: TestApi

beforeAll(() => {
  repo = makeFixtureRepo({ files: { 'src/app.ts': 'const a = 1\n', 'README.md': '# Hi\n' } })
  repo.write('src/app.ts', 'const a = 2\nconst b = 3\n')
  repo.write('src/new.ts', 'export {}\n')
  repo.git('add', '-A')
  repo.git('commit', '-m', 'Second commit')
  repo.write('pnpm-lock.yaml', 'lockfileVersion: 9\n')
  repo.rm('README.md')
  repo.git('add', '-A')
  repo.git('commit', '-m', 'Lockfile commit')
  testApi = createTestApi(repo.root)
  installTestApi(testApi)
})

afterAll(() => {
  testApi.dispose()
  repo.cleanup()
})

beforeEach(() => {
  useDiffStore.setState({
    repoPath: repo.root,
    source: { kind: 'commit', ref: 'HEAD~1' },
    summary: null,
    status: 'loading',
    filter: '',
    viewed: new Set(),
    collapsed: new Set()
  })
})

describe('DiffApp', () => {
  it('lists the commit’s files and renders a diff for each', async () => {
    render(<DiffApp />)
    expect(await screen.findByRole('heading', { name: 'Second commit' })).toBeInTheDocument()

    const nav = screen.getByRole('navigation')
    expect(within(nav).getByText('app.ts')).toBeInTheDocument()
    expect(within(nav).getByText('new.ts')).toBeInTheDocument()
    expect(within(nav).queryByText('README.md')).toBeNull()

    // both files mount an editor: a split view for the change, a single one for the add
    await waitFor(() => expect(document.querySelectorAll('.cm-mergeView')).toHaveLength(1))
    await waitFor(() => expect(document.querySelector('.diff-all-added')).not.toBeNull())
    expect(document.querySelector('.diff-all-added')).toHaveTextContent('export {}')
  })

  it('switches to unified layout', async () => {
    const user = userEvent.setup()
    render(<DiffApp />)
    await screen.findByRole('heading', { name: 'Second commit' })
    await user.click(screen.getByRole('button', { name: 'unified' }))
    await waitFor(() => expect(document.querySelectorAll('.cm-mergeView')).toHaveLength(0))
    expect(useDiffStore.getState().layout).toBe('unified')
    useDiffStore.getState().setLayout('split')
  })

  it('marks files viewed, collapsing them', async () => {
    const user = userEvent.setup()
    render(<DiffApp />)
    await screen.findByRole('heading', { name: 'Second commit' })
    const [first] = screen.getAllByRole('checkbox', { name: 'Viewed' })
    await user.click(first)
    expect(useDiffStore.getState().viewed.has('src/app.ts')).toBe(true)
    expect(screen.getByText('1/2 viewed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand src/app.ts' })).toBeInTheDocument()
  })

  it('filters the file list', async () => {
    const user = userEvent.setup()
    render(<DiffApp />)
    await screen.findByRole('heading', { name: 'Second commit' })
    await user.type(screen.getByPlaceholderText('Filter files'), 'new')
    const nav = screen.getByRole('navigation')
    expect(within(nav).queryByText('app.ts')).toBeNull()
    expect(within(nav).getByText('new.ts')).toBeInTheDocument()
  })

  it('loads whatever is typed in the comparison field', async () => {
    const user = userEvent.setup()
    render(<DiffApp />)
    await screen.findByRole('heading', { name: 'Second commit' })
    const field = screen.getByRole('textbox', { name: 'Comparison' })
    await user.clear(field)
    await user.type(field, 'HEAD~2{Enter}')
    // the first commit added both original files
    expect(await screen.findByRole('heading', { name: 'fixture: initial' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation')).getByText('README.md')).toBeInTheDocument()
  })

  it('shows git errors with a retry', async () => {
    useDiffStore.setState({ source: { kind: 'commit', ref: 'no-such-ref' } })
    render(<DiffApp />)
    expect(await screen.findByText('Unknown revision: no-such-ref')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('offers recent commits in the picker and loads the one clicked', async () => {
    const user = userEvent.setup()
    render(<DiffApp />)
    await screen.findByRole('heading', { name: 'Second commit' })
    await user.click(screen.getByRole('textbox', { name: 'Comparison' }))
    expect(await screen.findByText('Recent commits')).toBeInTheDocument()
    expect(screen.getByText(/Pull requests unavailable/)).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /Lockfile commit/ }))
    expect(
      await screen.findByRole('heading', { name: 'Lockfile commit' }, { timeout: 5000 })
    ).toBeInTheDocument()
  })

  it('folds generated files and deletions show the old content', async () => {
    const user = userEvent.setup()
    useDiffStore.setState({ source: { kind: 'commit', ref: 'HEAD' } })
    render(<DiffApp />)
    await screen.findByRole('heading', { name: 'Lockfile commit' })
    expect(screen.getByText(/Generated file.*hidden|generated diff/)).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('.diff-all-deleted')).not.toBeNull())
    expect(document.querySelector('.diff-all-deleted')).toHaveTextContent('# Hi')

    await user.click(screen.getByRole('button', { name: 'Load diff' }))
    await waitFor(() => expect(document.querySelector('.diff-all-added')).not.toBeNull())
    expect(document.querySelector('.diff-all-added')).toHaveTextContent('lockfileVersion')
  })

  it('j/k move between files and v marks the current one viewed', async () => {
    const user = userEvent.setup()
    render(<DiffApp />)
    await screen.findByRole('heading', { name: 'Second commit' })
    expect(useDiffStore.getState().activePath).toBe('src/app.ts')
    await user.keyboard('j')
    expect(useDiffStore.getState().activePath).toBe('src/new.ts')
    await user.keyboard('v')
    expect(useDiffStore.getState().viewed.has('src/new.ts')).toBe(true)
    await user.keyboard('k')
    expect(useDiffStore.getState().activePath).toBe('src/app.ts')
  })

  it('Close Tab from the menu closes the window', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    render(<DiffApp />)
    await screen.findByRole('heading', { name: 'Second commit' })
    testApi.emitMenuCommand('close-tab')
    expect(close).toHaveBeenCalled()
    close.mockRestore()
  })
})
