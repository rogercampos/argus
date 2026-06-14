import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createTestApi, installTestApi, type TestApi } from '../../../../test/apiAdapter'
import { makeFixtureRepo, sampleProjectFiles } from '../../../../test/fixtures'
import type { CrashReport } from '../../../shared/types'
import { MAX_CRASH_CARDS, mergeCrash, useWorkspaceStore } from '../store'
import { CrashOverlay } from './CrashOverlay'

function makeReport(over: Partial<CrashReport> = {}): CrashReport {
  return {
    id: 'r1',
    at: 1,
    origin: 'lsp',
    title: 'Language server crashed',
    label: 'vtsls (repo)',
    summary: 'killed by signal SIGSEGV (code null)',
    detail: 'FATAL: out of memory\n  at frame 1\n  at frame 2',
    ...over
  }
}

describe('mergeCrash', () => {
  it('prepends newest first', () => {
    const a = makeReport({ id: 'a' })
    const b = makeReport({ id: 'b', summary: 'different' })
    expect(mergeCrash([a], b).map((c) => c.id)).toEqual(['b', 'a'])
  })

  it('skips an identical crash that is still shown', () => {
    const a = makeReport({ id: 'a' })
    const dup = makeReport({ id: 'b' }) // same signature fields, different id
    expect(mergeCrash([a], dup)).toEqual([a])
  })

  it('treats a changed field as a new crash', () => {
    const a = makeReport({ id: 'a' })
    const changed = makeReport({ id: 'b', detail: 'a new stack' })
    expect(mergeCrash([a], changed)).toHaveLength(2)
  })

  it('caps the visible stack', () => {
    let list: CrashReport[] = []
    for (let i = 0; i < MAX_CRASH_CARDS + 3; i++) {
      list = mergeCrash(list, makeReport({ id: `r${i}`, summary: `s${i}` }))
    }
    expect(list).toHaveLength(MAX_CRASH_CARDS)
    expect(list[0].id).toBe(`r${MAX_CRASH_CARDS + 2}`) // newest kept
  })
})

describe('CrashOverlay', () => {
  let testApi: TestApi

  beforeAll(() => {
    const repo = makeFixtureRepo({ files: sampleProjectFiles() })
    testApi = createTestApi(repo.root)
    installTestApi(testApi)
  })

  afterEach(() => {
    useWorkspaceStore.setState({ crashes: [] })
  })

  it('renders nothing with no crashes', () => {
    const { container } = render(<CrashOverlay />)
    expect(container.firstChild).toBeNull()
  })

  it('shows title, label and summary; toggles full output', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({ crashes: [makeReport()] })
    render(<CrashOverlay />)

    expect(screen.getByText('Language server crashed')).toBeInTheDocument()
    expect(screen.getByText('vtsls (repo)')).toBeInTheDocument()
    expect(screen.getByText(/killed by signal SIGSEGV/)).toBeInTheDocument()

    // detail hidden until expanded
    expect(screen.queryByText(/FATAL: out of memory/)).not.toBeInTheDocument()
    await user.click(screen.getByText('Show full output'))
    expect(screen.getByText(/FATAL: out of memory/)).toBeInTheDocument()
    await user.click(screen.getByText('Hide output'))
    expect(screen.queryByText(/FATAL: out of memory/)).not.toBeInTheDocument()
  })

  it('copies the full report to the clipboard', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({ crashes: [makeReport()] })
    render(<CrashOverlay />)

    await user.click(screen.getByTitle('Copy full output'))
    const written = testApi.calls.clipboardWrites.at(-1) ?? ''
    expect(written).toContain('Language server crashed — vtsls (repo)')
    expect(written).toContain('killed by signal SIGSEGV')
    expect(written).toContain('FATAL: out of memory')
  })

  it('dismisses a card', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({ crashes: [makeReport()] })
    render(<CrashOverlay />)

    await user.click(screen.getByLabelText('Dismiss'))
    expect(useWorkspaceStore.getState().crashes).toEqual([])
  })
})
