import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

/** CodeMirror theme wired to the design tokens (spec 13). */

const chrome = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: '13px',
      backgroundColor: 'var(--color-primary)',
      color: 'var(--color-fg)'
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.5'
    },
    '.cm-content': { caretColor: 'var(--color-caret)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-caret)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
      {
        backgroundColor: 'var(--color-selection)'
      },
    '.cm-activeLine': { backgroundColor: '#ffffff08' },
    '.cm-gutters': {
      backgroundColor: 'var(--color-primary)',
      color: 'var(--color-fg-dim)',
      border: 'none'
    },
    '.cm-activeLineGutter': { backgroundColor: '#ffffff08' },
    '.cm-matchingBracket': { backgroundColor: '#528bff44', outline: 'none' },
    '.cm-selectionMatch': { backgroundColor: '#383e4c88' }
  },
  { dark: true }
)

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword], color: '#c678dd' },
  { tag: [tags.string, tags.special(tags.string)], color: '#98c379' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: '#d19a66' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: '#56b6c2' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#61afef' },
  {
    tag: [tags.comment, tags.blockComment, tags.lineComment],
    color: '#808898',
    fontStyle: 'italic'
  },
  { tag: [tags.propertyName, tags.attributeName], color: '#e06c75' },
  { tag: [tags.operator, tags.punctuation], color: '#dde1e8' },
  { tag: tags.invalid, color: '#e06c75', textDecoration: 'underline' }
])

export const argusEditorTheme: Extension[] = [chrome, syntaxHighlighting(highlight)]
