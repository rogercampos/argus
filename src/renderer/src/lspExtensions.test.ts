import { currentCompletions, startCompletion } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestApi, installTestApi, type TestApi } from '../../../test/apiAdapter'
import { type FixtureRepo, makeFixtureRepo, sampleProjectFiles } from '../../../test/fixtures'
import { cmdClickDefinition, lspExtensions } from './lsp'

/** The LSP-driven CodeMirror extensions, against canned server answers. */
describe('LSP editor extensions (spec 08)', () => {
  let repo: FixtureRepo
  let testApi: TestApi
  const views: EditorView[] = []

  function makeView(path: string, doc: string): EditorView {
    const view = new EditorView({ parent: document.body })
    view.setState(
      EditorState.create({
        doc,
        extensions: [...lspExtensions(path), cmdClickDefinition()]
      })
    )
    views.push(view)
    return view
  }

  beforeAll(() => {
    repo = makeFixtureRepo({ files: sampleProjectFiles() })
    testApi = createTestApi(repo.root)
    installTestApi(testApi)
  })

  afterAll(() => {
    for (const view of views) view.destroy()
    testApi.dispose()
    repo.cleanup()
  })

  it('produces no extensions for non-LSP files', () => {
    expect(lspExtensions('README.md')).toEqual([])
  })

  it('the completion source surfaces canned server items', async () => {
    testApi.lsp.completions = [
      { label: 'greetUser', detail: 'fn', insertText: 'greetUser()' },
      { label: 'greetAll', insertText: 'greetAll' }
    ]
    const view = makeView('src/app.ts', 'gre')
    view.dispatch({ selection: { anchor: 3 } })
    startCompletion(view)

    await vi.waitFor(
      () => {
        const options = currentCompletions(view.state)
        expect(options.map((o) => o.label)).toContain('greetUser')
      },
      { timeout: 5000 }
    )
  })

  it('the completion source stays quiet when the server has nothing', async () => {
    testApi.lsp.completions = []
    const view = makeView('src/empty.ts', 'xyz')
    view.dispatch({ selection: { anchor: 3 } })
    startCompletion(view)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(currentCompletions(view.state)).toEqual([])
  })

  it('cmd+click is ignored without coordinates (jsdom has no layout)', () => {
    const view = makeView('src/click.ts', 'const a = 1')
    const event = new MouseEvent('mousedown', {
      metaKey: true,
      button: 0,
      bubbles: true,
      clientX: 5,
      clientY: 5
    })
    // must not throw; posAtCoords yields nothing meaningful in jsdom
    view.contentDOM.dispatchEvent(event)
    const plain = new MouseEvent('mousedown', { button: 0, bubbles: true })
    view.contentDOM.dispatchEvent(plain)
  })

  it('the cmd-hover plugin tracks meta key state without crashing', async () => {
    const view = makeView('src/hover.ts', 'const symbol = 1')
    // mouse over + meta held → the plugin schedules a definition check
    view.contentDOM.dispatchEvent(
      new MouseEvent('mousemove', { metaKey: true, clientX: 10, clientY: 10, bubbles: true })
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }))
    await new Promise((resolve) => setTimeout(resolve, 150))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', metaKey: false }))
    view.contentDOM.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
    view.destroy() // plugin destroy removes the key listeners
    views.splice(views.indexOf(view), 1)
  })
})
