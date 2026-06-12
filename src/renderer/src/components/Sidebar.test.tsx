import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApi, installTestApi, type TestApi } from '../../../../test/apiAdapter'
import { type FixtureRepo, makeFixtureRepo, sampleProjectFiles } from '../../../../test/fixtures'
import { activeTabPath, useWorkspaceStore } from '../store'
import { Sidebar } from './Sidebar'

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

/** the tree renders into a custom element's shadow DOM (testing-library
 * cannot pierce it) — query rows by the library's data attributes */
function shadow(container: HTMLElement): ShadowRoot {
  const host = container.querySelector('file-tree-container')
  if (!host?.shadowRoot) throw new Error('tree shadow root missing')
  return host.shadowRoot
}

async function row(container: HTMLElement, path: string): Promise<HTMLElement> {
  let element: HTMLElement | null = null
  await waitFor(() => {
    element = shadow(container).querySelector(`[data-item-path="${path}"]`)
    expect(element).not.toBeNull()
  })
  return element as unknown as HTMLElement
}

/** context-menu entries may mount in the light DOM or the shadow root */
function menuButton(container: HTMLElement, label: string): HTMLElement | null {
  const all = [
    ...Array.from(document.querySelectorAll('button')),
    ...Array.from(shadow(container).querySelectorAll('button'))
  ]
  return all.find((b) => b.textContent === label) ?? null
}

describe('Sidebar file tree (spec 07)', () => {
  it('renders rows for the workspace, directories first', async () => {
    const { container } = render(<Sidebar />)
    await row(container, 'README.md')
    const paths = Array.from(shadow(container).querySelectorAll('[data-item-path]')).map((el) =>
      el.getAttribute('data-item-path')
    )
    expect(paths).toEqual(['docs/', 'src/', '.gitignore', 'package.json', 'README.md'])
  })

  it('clicking a file row opens it in the editor', async () => {
    const { container } = render(<Sidebar />)
    const readme = await row(container, 'README.md')
    fireEvent.click(readme)
    await waitFor(() => expect(activeTabPath()).toBe('README.md'))
  })

  it('expanding a directory reveals its children', async () => {
    const { container } = render(<Sidebar />)
    const src = await row(container, 'src/')
    fireEvent.click(src)
    await row(container, 'src/index.ts')
    await row(container, 'src/lib/')
  })

  it('context menu: star and unstar a top-level folder', async () => {
    const { container } = render(<Sidebar />)
    const docs = await row(container, 'docs/')

    fireEvent.contextMenu(docs)
    await waitFor(() => expect(menuButton(container, 'Star')).not.toBeNull())
    fireEvent.click(menuButton(container, 'Star') as HTMLElement)
    await waitFor(() => expect(useWorkspaceStore.getState().starredFolders).toContain('docs'))

    fireEvent.contextMenu(await row(container, 'docs/'))
    await waitFor(() => expect(menuButton(container, 'Unstar')).not.toBeNull())
    fireEvent.click(menuButton(container, 'Unstar') as HTMLElement)
    await waitFor(() => expect(useWorkspaceStore.getState().starredFolders).toEqual([]))
  })

  it('context menu: copy paths, reveal, exclude', async () => {
    const { container } = render(<Sidebar />)
    const docs = await row(container, 'docs/')

    fireEvent.contextMenu(docs)
    await waitFor(() => expect(menuButton(container, 'Copy Relative Path')).not.toBeNull())
    fireEvent.click(menuButton(container, 'Copy Relative Path') as HTMLElement)
    await waitFor(() => expect(testApi.calls.clipboardWrites).toContain('docs'))

    fireEvent.contextMenu(await row(container, 'docs/'))
    await waitFor(() => expect(menuButton(container, 'Reveal in Finder')).not.toBeNull())
    fireEvent.click(menuButton(container, 'Reveal in Finder') as HTMLElement)
    await waitFor(() => expect(testApi.calls.revealedPaths).toContain('docs'))

    fireEvent.contextMenu(await row(container, 'docs/'))
    await waitFor(() => expect(menuButton(container, 'Exclude from Project')).not.toBeNull())
    fireEvent.click(menuButton(container, 'Exclude from Project') as HTMLElement)
    await waitFor(() => expect(useWorkspaceStore.getState().excludedPaths).toContain('docs'))

    fireEvent.contextMenu(await row(container, 'docs/'))
    await waitFor(() => expect(menuButton(container, 'Remove from Excluded Paths')).not.toBeNull())
    fireEvent.click(menuButton(container, 'Remove from Excluded Paths') as HTMLElement)
    await waitFor(() => expect(useWorkspaceStore.getState().excludedPaths).not.toContain('docs'))
  })

  it('context menu: Find in Folder opens the scoped search modal', async () => {
    const { container } = render(<Sidebar />)
    fireEvent.contextMenu(await row(container, 'docs/'))
    await waitFor(() => expect(menuButton(container, 'Find in Folder…')).not.toBeNull())
    fireEvent.click(menuButton(container, 'Find in Folder…') as HTMLElement)

    const { useSearchStore } = await import('../searchStore')
    await waitFor(() => {
      expect(useSearchStore.getState().modalOpen).toBe(true)
      expect(useSearchStore.getState().modalScope).toBe('docs')
    })
  })
})
