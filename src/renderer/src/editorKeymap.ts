import {
  copyLineDown,
  deleteLine,
  indentWithTab,
  moveLineDown,
  moveLineUp,
  selectParentSyntax
} from '@codemirror/commands'
import { EditorSelection, type Extension, Prec } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'

/** Editor keybindings beyond the defaults (spec 14), RubyMine-style. */

interface SelectionShape {
  anchor: number
  head: number
}

interface ExpandStack {
  prev: SelectionShape[]
  last: SelectionShape | null
}

const expandStacks = new WeakMap<EditorView, ExpandStack>()

function currentShape(view: EditorView): SelectionShape {
  const { anchor, head } = view.state.selection.main
  return { anchor, head }
}

function sameShape(a: SelectionShape | null, b: SelectionShape): boolean {
  return a !== null && a.anchor === b.anchor && a.head === b.head
}

/** Alt+Up — expand the selection to the enclosing syntax node (spec 06). */
function expandSelection(view: EditorView): boolean {
  let stack = expandStacks.get(view)
  const before = currentShape(view)
  // A selection change outside expand/shrink invalidates the stack
  if (!stack || !sameShape(stack.last, before)) {
    stack = { prev: [], last: null }
    expandStacks.set(view, stack)
  }
  stack.prev.push(before)
  if (!selectParentSyntax(view)) {
    stack.prev.pop()
    return false
  }
  stack.last = currentShape(view)
  return true
}

/** Alt+Down — shrink back one expansion step. */
function shrinkSelection(view: EditorView): boolean {
  const stack = expandStacks.get(view)
  if (!stack || stack.prev.length === 0 || !sameShape(stack.last, currentShape(view))) {
    return false
  }
  const target = stack.prev.pop() as SelectionShape
  view.dispatch({
    selection: EditorSelection.single(target.anchor, target.head),
    scrollIntoView: true
  })
  stack.last = target
  return true
}

/** Cmd+Enter — new line below, cursor anywhere in the line (spec 06). */
function newLineBelow(view: EditorView): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  view.dispatch({
    changes: { from: line.to, insert: '\n' },
    selection: { anchor: line.to + 1 },
    scrollIntoView: true
  })
  return true
}

/** Cmd+Shift+Enter — new line above. */
function newLineAbove(view: EditorView): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  view.dispatch({
    changes: { from: line.from, insert: '\n' },
    selection: { anchor: line.from },
    scrollIntoView: true
  })
  return true
}

export function argusKeymap(onSave: (view: EditorView) => void): Extension {
  return Prec.high(
    keymap.of([
      {
        key: 'Mod-s',
        run: (view) => {
          onSave(view)
          return true
        }
      },
      { key: 'Mod-d', run: copyLineDown },
      { key: 'Mod-Backspace', run: deleteLine },
      { key: 'Alt-Shift-ArrowUp', run: moveLineUp },
      { key: 'Alt-Shift-ArrowDown', run: moveLineDown },
      { key: 'Alt-ArrowUp', run: expandSelection },
      { key: 'Alt-ArrowDown', run: shrinkSelection },
      { key: 'Mod-Enter', run: newLineBelow },
      { key: 'Mod-Shift-Enter', run: newLineAbove },
      indentWithTab
    ])
  )
}
