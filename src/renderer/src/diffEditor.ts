import { defaultKeymap } from '@codemirror/commands'
import { MergeView, unifiedMergeView } from '@codemirror/merge'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { EditorState, type Extension } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightSpecialChars,
  keymap,
  lineNumbers
} from '@codemirror/view'
import { argusEditorTheme } from './editorTheme'
import { languageFor } from './languages'

/**
 * Read-only CodeMirror views for the diff window. Same theme, same
 * per-language highlighting (incl. Ruby tree-sitter) as the main editor —
 * @codemirror/merge does the diffing, alignment and unchanged-line folding.
 *
 * - both sides present → MergeView (split) or unifiedMergeView (unified)
 * - one side only (added/deleted file) → a single editor tinted whole
 */

export type DiffLayout = 'split' | 'unified'

/** Unchanged stretches fold down to this much context around each change. */
const COLLAPSE = { margin: 3, minSize: 4 }

/** The editor that last had focus, for the menu's Find command. */
let lastFocused: EditorView | null = null
export function lastFocusedDiffEditor(): EditorView | null {
  return lastFocused?.dom.isConnected ? lastFocused : null
}

const trackFocus = EditorView.updateListener.of((update) => {
  if (update.focusChanged && update.view.hasFocus) lastFocused = update.view
})

const diffTheme = EditorView.theme(
  {
    '&': { height: 'auto' },
    '.cm-scroller': { overflow: 'visible' },
    '.cm-content': { paddingBlock: '2px' },
    // changed lines: tinted rows, stronger tint on the exact changed text
    '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': {
      backgroundColor: 'var(--color-diff-deleted)'
    },
    '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
      backgroundColor: 'var(--color-diff-added)'
    },
    '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': {
      background: 'var(--color-diff-deleted-strong)'
    },
    '&.cm-merge-b .cm-changedText': { background: 'var(--color-diff-added-strong)' },
    '&.cm-merge-b .cm-deletedText': { background: 'var(--color-diff-deleted-strong)' },
    '.cm-changeGutter': { width: '3px', paddingLeft: '0' },
    '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': {
      background: 'var(--color-git-deleted)'
    },
    '&.cm-merge-b .cm-changedLineGutter': { background: 'var(--color-git-added)' },
    '.cm-inlineChangedLineGutter': { background: 'var(--color-git-modified)' },
    '.cm-collapsedLines': {
      color: 'var(--color-fg-dim)',
      background: 'var(--color-secondary)',
      fontFamily: 'var(--font-ui)',
      fontSize: 'var(--text-label)',
      padding: '4px 10px',
      borderBlock: '1px solid var(--color-edge)'
    },
    '.cm-collapsedLines:hover': { color: 'var(--color-accent)' },
    '.cm-collapsedLines:before, .cm-collapsedLines:after': { content: '"⋯"' }
  },
  { dark: true }
)

function baseExtensions(path: string): Extension[] {
  return [
    lineNumbers(),
    highlightSpecialChars(),
    drawSelection(),
    highlightSelectionMatches(),
    search({ top: true }),
    keymap.of([...searchKeymap, ...defaultKeymap]),
    EditorState.readOnly.of(true),
    EditorView.lineWrapping,
    trackFocus,
    ...argusEditorTheme,
    diffTheme,
    ...languageFor(path)
  ]
}

export interface DiffViewInput {
  parent: HTMLElement
  layout: DiffLayout
  /** null: the side doesn't exist (added/deleted file) */
  oldText: string | null
  newText: string | null
  oldPath: string
  newPath: string
}

export interface DiffViewHandle {
  destroy(): void
}

export function createDiffView(input: DiffViewInput): DiffViewHandle {
  const { parent, layout, oldText, newText, oldPath, newPath } = input

  if (oldText === null || newText === null) {
    // whole-file add/delete: no counterpart to align against
    const added = oldText === null
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: (added ? newText : oldText) ?? '',
        extensions: [
          baseExtensions(added ? newPath : oldPath),
          EditorView.editorAttributes.of({ class: added ? 'diff-all-added' : 'diff-all-deleted' })
        ]
      })
    })
    return { destroy: () => view.destroy() }
  }

  if (layout === 'split') {
    const view = new MergeView({
      parent,
      a: { doc: oldText, extensions: baseExtensions(oldPath) },
      b: { doc: newText, extensions: baseExtensions(newPath) },
      gutter: true,
      highlightChanges: true,
      collapseUnchanged: COLLAPSE
    })
    return { destroy: () => view.destroy() }
  }

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: newText,
      extensions: [
        baseExtensions(newPath),
        unifiedMergeView({
          original: oldText,
          mergeControls: false,
          gutter: true,
          highlightChanges: true,
          syntaxHighlightDeletions: true,
          syntaxHighlightDeletionsMaxLength: 50_000,
          collapseUnchanged: COLLAPSE
        })
      ]
    })
  })
  return { destroy: () => view.destroy() }
}
