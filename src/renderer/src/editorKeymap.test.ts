import { javascript } from '@codemirror/lang-javascript'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { argusKeymap } from './editorKeymap'

/**
 * Real CodeMirror views receiving real keydown events. jsdom is not macOS,
 * so CM maps Mod to Ctrl here.
 */

const views: EditorView[] = []

function makeView(doc: string, cursor = 0, onSave: () => void = () => {}): EditorView {
  const view = new EditorView({ parent: document.body })
  view.setState(
    EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [argusKeymap(onSave), javascript()]
    })
  )
  views.push(view)
  return view
}

function key(
  view: EditorView,
  keyName: string,
  modifiers: Partial<{ ctrl: boolean; alt: boolean; shift: boolean }> = {}
): void {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: keyName,
      ctrlKey: modifiers.ctrl ?? false,
      altKey: modifiers.alt ?? false,
      shiftKey: modifiers.shift ?? false,
      bubbles: true,
      cancelable: true
    })
  )
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
})

describe('editor keymap (spec 14)', () => {
  it('Mod-s triggers the save callback', () => {
    let saved = 0
    const view = makeView('const a = 1\n', 0, () => saved++)
    key(view, 's', { ctrl: true })
    expect(saved).toBe(1)
  })

  it('Mod-d duplicates the current line', () => {
    const view = makeView('first\nsecond\n')
    key(view, 'd', { ctrl: true })
    expect(view.state.doc.toString()).toBe('first\nfirst\nsecond\n')
  })

  it('Mod-Backspace deletes the current line', () => {
    const view = makeView('first\nsecond\n')
    key(view, 'Backspace', { ctrl: true })
    expect(view.state.doc.toString()).toBe('second\n')
  })

  it('Alt-Shift arrows move the line', () => {
    const view = makeView('first\nsecond\n')
    key(view, 'ArrowDown', { alt: true, shift: true })
    expect(view.state.doc.toString()).toBe('second\nfirst\n')
    key(view, 'ArrowUp', { alt: true, shift: true })
    expect(view.state.doc.toString()).toBe('first\nsecond\n')
  })

  it('Mod-Enter opens a line below, cursor anywhere in the line', () => {
    const view = makeView('abc\ndef\n', 1)
    key(view, 'Enter', { ctrl: true })
    expect(view.state.doc.toString()).toBe('abc\n\ndef\n')
    expect(view.state.selection.main.head).toBe(4)
  })

  it('Mod-Shift-Enter opens a line above', () => {
    const view = makeView('abc\ndef\n', 5)
    key(view, 'Enter', { ctrl: true, shift: true })
    expect(view.state.doc.toString()).toBe('abc\n\ndef\n')
    expect(view.state.selection.main.head).toBe(4)
  })

  it('Alt-Up expands the selection through enclosing syntax; Alt-Down shrinks back', () => {
    // cursor inside the string literal
    const doc = 'const a = "hello"\n'
    const view = makeView(doc, 12)

    key(view, 'ArrowUp', { alt: true })
    const firstExpansion = view.state.selection.main
    expect(firstExpansion.to - firstExpansion.from).toBeGreaterThan(0)

    key(view, 'ArrowUp', { alt: true })
    const secondExpansion = view.state.selection.main
    expect(secondExpansion.to - secondExpansion.from).toBeGreaterThanOrEqual(
      firstExpansion.to - firstExpansion.from
    )

    key(view, 'ArrowDown', { alt: true })
    expect(view.state.selection.main.from).toBe(firstExpansion.from)
    expect(view.state.selection.main.to).toBe(firstExpansion.to)

    key(view, 'ArrowDown', { alt: true })
    expect(view.state.selection.main.head).toBe(12)
    expect(view.state.selection.main.empty).toBe(true)

    // shrinking past the start of the stack is a no-op
    key(view, 'ArrowDown', { alt: true })
    expect(view.state.selection.main.head).toBe(12)
  })

  it('a manual selection change invalidates the expand stack', () => {
    const view = makeView('const a = "hello"\n', 12)
    key(view, 'ArrowUp', { alt: true })
    view.dispatch({ selection: { anchor: 0 } }) // user moved the cursor
    key(view, 'ArrowDown', { alt: true }) // nothing to shrink to
    expect(view.state.selection.main.head).toBe(0)
  })
})
