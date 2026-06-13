import {
  copyLineDown,
  deleteLine,
  indentWithTab,
  moveLineDown,
  moveLineUp,
  selectParentSyntax
} from '@codemirror/commands'
import { Compartment, EditorSelection, type Extension, Prec } from '@codemirror/state'
import { type Command, type EditorView, type KeyBinding, keymap } from '@codemirror/view'
import { type ShortcutCommandId, toCodeMirrorKey } from '../../shared/shortcuts'
import { onKeymapChange, useKeymapStore } from './keymapStore'
import { activeTabPath, activeView, documents } from './store'

/**
 * Editor keybindings (spec 14). Keys come from the user's keymap (Settings →
 * Keyboard); the bindings live in a Compartment so changing a shortcut
 * re-binds the open editor live without reopening the document.
 */

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

/** Save the active document (path-independent so the keymap is shared). */
const saveActive: Command = (): boolean => {
  const path = activeTabPath()
  if (path) void documents.save(path)
  return true
}

/** Editor commands that participate in the configurable keymap. */
const EDITOR_RUN: Partial<Record<ShortcutCommandId, Command>> = {
  save: saveActive,
  'duplicate-line': copyLineDown,
  'move-line-up': moveLineUp,
  'move-line-down': moveLineDown,
  'delete-line': deleteLine,
  'new-line-below': newLineBelow,
  'new-line-above': newLineAbove,
  'expand-selection': expandSelection,
  'shrink-selection': shrinkSelection
}

/** Build the editor keymap from the current effective bindings. */
function buildEditorKeymap(): Extension {
  const { bindings } = useKeymapStore.getState()
  const keys: KeyBinding[] = []
  for (const [id, run] of Object.entries(EDITOR_RUN) as Array<[ShortcutCommandId, Command]>) {
    const accel = bindings[id]
    if (accel) keys.push({ key: toCodeMirrorKey(accel), run })
  }
  // Tab-to-indent is fixed (not user-configurable).
  return Prec.high(keymap.of([...keys, indentWithTab]))
}

/** Compartment so a shortcut change re-binds the open editor without reopening. */
const keymapCompartment = new Compartment()

export function argusKeymap(): Extension {
  return keymapCompartment.of(buildEditorKeymap())
}

/** Re-apply the current keymap to a view (call after setState or on change). */
export function reconfigureKeymap(view: EditorView): void {
  view.dispatch({ effects: keymapCompartment.reconfigure(buildEditorKeymap()) })
}

// Re-bind the live editor whenever the keymap changes.
onKeymapChange(() => {
  const view = activeView()
  if (view) reconfigureKeymap(view)
})
