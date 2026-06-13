import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApi, installTestApi, type TestApi } from '../../../../test/apiAdapter'
import { type FixtureRepo, makeFixtureRepo, sampleProjectFiles } from '../../../../test/fixtures'
import { useKeymapStore } from '../keymapStore'
import { useWorkspaceStore } from '../store'
import { SettingsModal } from './SettingsModal'

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

describe('SettingsModal — General (excluded paths)', () => {
  it('lists, adds (normalized), and removes excluded paths', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({ openModal: 'settings', excludedPaths: ['vendor', 'tmp'] })
    render(<SettingsModal />)

    expect(screen.getByText('vendor')).toBeInTheDocument()
    expect(screen.getByText('tmp')).toBeInTheDocument()

    // add — surrounding slashes are trimmed
    fireEvent.change(screen.getByPlaceholderText(/coverage/), { target: { value: '/coverage/' } })
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(useWorkspaceStore.getState().excludedPaths).toContain('coverage'))

    // remove
    await user.click(screen.getByTitle('Remove vendor'))
    await waitFor(() => expect(useWorkspaceStore.getState().excludedPaths).not.toContain('vendor'))
  })

  it('does not add duplicates', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({ openModal: 'settings', excludedPaths: ['log'] })
    render(<SettingsModal />)
    fireEvent.change(screen.getByPlaceholderText(/coverage/), { target: { value: 'log' } })
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(useWorkspaceStore.getState().excludedPaths.filter((p) => p === 'log')).toHaveLength(1)
  })

  it('restores the default excluded paths', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({ openModal: 'settings', excludedPaths: [] })
    render(<SettingsModal />)
    await user.click(screen.getByRole('button', { name: 'Restore defaults' }))
    await waitFor(() =>
      expect(useWorkspaceStore.getState().excludedPaths).toContain('node_modules')
    )
  })
})

describe('SettingsModal — Keyboard', () => {
  it('applies a preset template to all shortcuts', async () => {
    const user = userEvent.setup()
    useKeymapStore.getState().setTemplate('rubymine')
    useWorkspaceStore.setState({ openModal: 'settings' })
    render(<SettingsModal />)

    await user.click(screen.getByRole('button', { name: 'Keyboard' }))
    // RubyMine default: Go to File is ⌘⇧O
    expect(useKeymapStore.getState().bindings['go-to-file']).toBe('Mod+Shift+O')

    await user.click(screen.getByRole('button', { name: 'VS Code' }))
    expect(useKeymapStore.getState().config.template).toBe('vscode')
    expect(useKeymapStore.getState().bindings['go-to-file']).toBe('Mod+P')
    useKeymapStore.getState().setTemplate('rubymine') // reset for other tests
  })

  it('records a new shortcut by pressing keys', async () => {
    const user = userEvent.setup()
    useKeymapStore.getState().setTemplate('rubymine')
    useWorkspaceStore.setState({ openModal: 'settings' })
    render(<SettingsModal />)
    await user.click(screen.getByRole('button', { name: 'Keyboard' }))

    // open the recorder for "Go to Line…" and press a combination
    const row = screen.getByText('Go to Line…').closest('div') as HTMLElement
    await user.click(within(row).getByTitle('Click to change'))
    fireEvent.keyDown(window, { key: 'k', metaKey: true, shiftKey: true })

    await waitFor(() =>
      expect(useKeymapStore.getState().config.overrides['go-to-line']).toBe('Mod+Shift+K')
    )
    useKeymapStore.getState().setTemplate('rubymine') // clears overrides
  })
})

describe('SettingsModal — Rails', () => {
  it('toggles the Rails schema auto-open setting', async () => {
    const user = userEvent.setup()
    useWorkspaceStore.setState({ openModal: 'settings', railsAutoSchema: true })
    render(<SettingsModal />)

    await user.click(screen.getByRole('button', { name: 'Rails' }))
    const toggle = screen.getByRole('checkbox', { name: 'Auto-open schema panel' })
    expect(toggle).toBeChecked()

    await user.click(toggle)
    await waitFor(() => expect(useWorkspaceStore.getState().railsAutoSchema).toBe(false))
  })
})
