import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { SYNTAX_CLASS_RULES } from './languages'

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

// shared tag → tsh-* class rules; colors live in main.css (spec 13), the
// same classes the Ruby tree-sitter highlighter and search rows use
const highlight = HighlightStyle.define(SYNTAX_CLASS_RULES)

export const argusEditorTheme: Extension[] = [chrome, syntaxHighlighting(highlight)]
