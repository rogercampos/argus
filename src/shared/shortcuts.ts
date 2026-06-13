import type { MenuCommand } from './types'

/**
 * Single source of truth for every configurable keyboard shortcut (spec: user
 * settings). Both the main process (native menu accelerators) and the renderer
 * (CodeMirror editor keymap + settings UI) read from here, so a binding is
 * defined once and converted to each consumer's format.
 *
 * Canonical accelerator format: `+`-joined tokens, modifiers first in the order
 * Mod, Ctrl, Alt, Shift, then a single key. `Mod` = Cmd on macOS / Ctrl
 * elsewhere. Keys are uppercase letters (`D`), digits (`1`), punctuation (`/`,
 * `[`), or named keys (`Enter`, `Backspace`, `Tab`, `ArrowUp`, `F6`).
 *   e.g. `Mod+Shift+O`, `Alt+Shift+ArrowUp`, `Mod+/`, `Shift+F6`
 */

export type Accelerator = string

export type ShortcutTemplateId = 'rubymine' | 'vscode' | 'sublime'

export const SHORTCUT_TEMPLATES: Array<{ id: ShortcutTemplateId; label: string }> = [
  { id: 'rubymine', label: 'RubyMine (default)' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'sublime', label: 'Sublime Text' }
]

export type ShortcutCategory =
  | 'Application'
  | 'File'
  | 'Edit'
  | 'View'
  | 'Navigate'
  | 'Code'
  | 'Editor'

/** Command ids: the configurable subset of MenuCommand, plus `open-folder`
 * (a menu item with no MenuCommand) and the editor-only line commands. */
export type ShortcutCommandId =
  | Exclude<MenuCommand, never>
  | 'open-folder'
  | 'delete-line'
  | 'new-line-below'
  | 'new-line-above'
  | 'expand-selection'
  | 'shrink-selection'

export interface ShortcutCommandDef {
  id: ShortcutCommandId
  label: string
  category: ShortcutCategory
  /** appears in the native application menu (most send their MenuCommand) */
  menu?: boolean
  /** bound in the CodeMirror editor keymap */
  editor?: boolean
}

/** Every configurable command, in display order. OS roles (undo/copy/zoom/…)
 * are intentionally excluded — they keep their system bindings. */
export const SHORTCUT_COMMANDS: ShortcutCommandDef[] = [
  { id: 'open-settings', label: 'Open Settings', category: 'Application', menu: true },
  { id: 'show-slow-ops', label: 'Show Slow Operations', category: 'Application', menu: true },

  { id: 'open-folder', label: 'Open Folder…', category: 'File', menu: true },
  { id: 'new-file', label: 'New File', category: 'File', menu: true },
  { id: 'save', label: 'Save', category: 'File', menu: true, editor: true },
  { id: 'save-all', label: 'Save All', category: 'File', menu: true },
  { id: 'close-tab', label: 'Close Tab', category: 'File', menu: true },

  { id: 'find', label: 'Find', category: 'Edit', menu: true },
  { id: 'replace', label: 'Replace', category: 'Edit', menu: true },
  { id: 'global-search', label: 'Find in Files', category: 'Edit', menu: true },
  { id: 'global-replace', label: 'Replace in Files', category: 'Edit', menu: true },
  { id: 'copy-relative-path', label: 'Copy Relative Path', category: 'Edit', menu: true },

  { id: 'toggle-file-tree', label: 'Toggle File Tree', category: 'View', menu: true },
  { id: 'toggle-search-panel', label: 'Toggle Search Panel', category: 'View', menu: true },
  { id: 'toggle-schema-panel', label: 'Toggle Schema Panel', category: 'View', menu: true },
  { id: 'show-projects', label: 'Show Projects', category: 'View', menu: true },
  { id: 'reveal-active-file', label: 'Reveal Active File', category: 'View', menu: true },
  { id: 'toggle-inlay-hints', label: 'Toggle Inlay Hints', category: 'View', menu: true },
  { id: 'next-tab', label: 'Next Tab', category: 'View', menu: true },
  { id: 'previous-tab', label: 'Previous Tab', category: 'View', menu: true },

  { id: 'go-to-file', label: 'Go to File…', category: 'Navigate', menu: true },
  { id: 'go-to-symbol', label: 'Go to Symbol…', category: 'Navigate', menu: true },
  { id: 'recent-files', label: 'Recent Files…', category: 'Navigate', menu: true },
  { id: 'go-to-line', label: 'Go to Line…', category: 'Navigate', menu: true },
  { id: 'jump-back', label: 'Back', category: 'Navigate', menu: true },
  { id: 'jump-forward', label: 'Forward', category: 'Navigate', menu: true },

  { id: 'go-to-definition', label: 'Go to Definition', category: 'Code', menu: true },
  { id: 'go-to-type-definition', label: 'Go to Type Definition', category: 'Code', menu: true },
  { id: 'show-hover', label: 'Show Hover Info', category: 'Code', menu: true },
  { id: 'quick-fixes', label: 'Show Quick Fixes', category: 'Code', menu: true },
  { id: 'rename-symbol', label: 'Rename Symbol', category: 'Code', menu: true },
  { id: 'format-document', label: 'Format Document', category: 'Code', menu: true },
  { id: 'comment-line', label: 'Comment Line', category: 'Code', menu: true },
  { id: 'duplicate-line', label: 'Duplicate Line', category: 'Code', menu: true, editor: true },
  { id: 'move-line-up', label: 'Move Line Up', category: 'Code', menu: true, editor: true },
  { id: 'move-line-down', label: 'Move Line Down', category: 'Code', menu: true, editor: true },

  { id: 'delete-line', label: 'Delete Line', category: 'Editor', editor: true },
  { id: 'new-line-below', label: 'New Line Below', category: 'Editor', editor: true },
  { id: 'new-line-above', label: 'New Line Above', category: 'Editor', editor: true },
  { id: 'expand-selection', label: 'Expand Selection', category: 'Editor', editor: true },
  { id: 'shrink-selection', label: 'Shrink Selection', category: 'Editor', editor: true }
]

type TemplateMap = Partial<Record<ShortcutCommandId, Accelerator>>

/** RubyMine — the app's historical defaults (menu.ts + editorKeymap.ts). */
const RUBYMINE: TemplateMap = {
  'open-settings': 'Mod+,',
  'open-folder': 'Mod+Shift+N',
  'new-file': 'Mod+N',
  save: 'Mod+S',
  'save-all': 'Mod+Alt+S',
  'close-tab': 'Mod+W',
  find: 'Mod+F',
  replace: 'Mod+R',
  'global-search': 'Mod+Shift+F',
  'global-replace': 'Mod+Shift+R',
  'copy-relative-path': 'Mod+Shift+C',
  'toggle-file-tree': 'Mod+1',
  'next-tab': 'Mod+Shift+]',
  'previous-tab': 'Mod+Shift+[',
  'go-to-file': 'Mod+Shift+O',
  'go-to-symbol': 'Mod+O',
  'recent-files': 'Mod+E',
  'go-to-line': 'Mod+L',
  'jump-back': 'Mod+Alt+ArrowLeft',
  'jump-forward': 'Mod+Alt+ArrowRight',
  'go-to-definition': 'Mod+B',
  'quick-fixes': 'Alt+Enter',
  'rename-symbol': 'Shift+F6',
  'comment-line': 'Mod+/',
  'duplicate-line': 'Mod+D',
  'move-line-up': 'Alt+Shift+ArrowUp',
  'move-line-down': 'Alt+Shift+ArrowDown',
  'delete-line': 'Mod+Backspace',
  'new-line-below': 'Mod+Enter',
  'new-line-above': 'Mod+Shift+Enter',
  'expand-selection': 'Alt+ArrowUp',
  'shrink-selection': 'Alt+ArrowDown'
}

/** VS Code-style bindings (approximated for this command set). */
const VSCODE: TemplateMap = {
  'open-settings': 'Mod+,',
  'open-folder': 'Mod+O',
  'new-file': 'Mod+N',
  save: 'Mod+S',
  'save-all': 'Mod+Alt+S',
  'close-tab': 'Mod+W',
  find: 'Mod+F',
  replace: 'Mod+Alt+F',
  'global-search': 'Mod+Shift+F',
  'global-replace': 'Mod+Shift+H',
  'copy-relative-path': 'Mod+Shift+C',
  'toggle-file-tree': 'Mod+B',
  'toggle-search-panel': 'Mod+Shift+M',
  'show-projects': 'Mod+Shift+P',
  'next-tab': 'Mod+Shift+]',
  'previous-tab': 'Mod+Shift+[',
  'go-to-file': 'Mod+P',
  'go-to-symbol': 'Mod+Shift+O',
  'go-to-line': 'Mod+G',
  'jump-back': 'Mod+Alt+ArrowLeft',
  'jump-forward': 'Mod+Alt+ArrowRight',
  'go-to-definition': 'F12',
  'go-to-type-definition': 'Mod+F12',
  'show-hover': 'Mod+K',
  'quick-fixes': 'Mod+.',
  'rename-symbol': 'F2',
  'format-document': 'Shift+Alt+F',
  'comment-line': 'Mod+/',
  'duplicate-line': 'Shift+Alt+ArrowDown',
  'move-line-up': 'Alt+ArrowUp',
  'move-line-down': 'Alt+ArrowDown',
  'delete-line': 'Mod+Shift+K',
  'new-line-below': 'Mod+Enter',
  'new-line-above': 'Mod+Shift+Enter',
  'expand-selection': 'Mod+Shift+ArrowRight',
  'shrink-selection': 'Mod+Shift+ArrowLeft'
}

/** Sublime Text-style bindings (approximated for this command set). */
const SUBLIME: TemplateMap = {
  'open-settings': 'Mod+,',
  'open-folder': 'Mod+O',
  'new-file': 'Mod+N',
  save: 'Mod+S',
  'save-all': 'Mod+Alt+S',
  'close-tab': 'Mod+W',
  find: 'Mod+F',
  replace: 'Mod+Alt+F',
  'global-search': 'Mod+Shift+F',
  'copy-relative-path': 'Mod+Shift+C',
  'toggle-file-tree': 'Mod+K',
  'next-tab': 'Mod+Alt+ArrowRight',
  'previous-tab': 'Mod+Alt+ArrowLeft',
  'go-to-file': 'Mod+P',
  'go-to-symbol': 'Mod+R',
  'recent-files': 'Mod+E',
  'go-to-line': 'Mod+G',
  'go-to-definition': 'F12',
  'comment-line': 'Mod+/',
  'duplicate-line': 'Mod+Shift+D',
  'move-line-up': 'Mod+Ctrl+ArrowUp',
  'move-line-down': 'Mod+Ctrl+ArrowDown',
  'delete-line': 'Mod+Shift+K',
  'new-line-below': 'Mod+Enter',
  'new-line-above': 'Mod+Shift+Enter',
  'expand-selection': 'Mod+Shift+A',
  'shrink-selection': 'Mod+Shift+J'
}

export const TEMPLATE_BINDINGS: Record<ShortcutTemplateId, TemplateMap> = {
  rubymine: RUBYMINE,
  vscode: VSCODE,
  sublime: SUBLIME
}

export const DEFAULT_TEMPLATE: ShortcutTemplateId = 'rubymine'

/** Persisted keymap config: a base template plus per-command overrides.
 * An override of `null` means "explicitly unbound". */
export interface KeymapConfig {
  template: ShortcutTemplateId
  overrides: Partial<Record<ShortcutCommandId, Accelerator | null>>
}

export function defaultKeymapConfig(): KeymapConfig {
  return { template: DEFAULT_TEMPLATE, overrides: {} }
}

/** Resolve the effective accelerator for every command (override ?? template). */
export function effectiveBindings(
  config: KeymapConfig
): Record<ShortcutCommandId, Accelerator | null> {
  const base = TEMPLATE_BINDINGS[config.template] ?? {}
  const result = {} as Record<ShortcutCommandId, Accelerator | null>
  for (const cmd of SHORTCUT_COMMANDS) {
    const override = config.overrides[cmd.id]
    result[cmd.id] = override !== undefined ? override : (base[cmd.id] ?? null)
  }
  return result
}

const ELECTRON_KEY: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
}

/** Canonical accelerator → Electron menu accelerator string. */
export function toElectronAccelerator(accel: Accelerator): string {
  return accel
    .split('+')
    .map((part) => {
      if (part === 'Mod') return 'CmdOrCtrl'
      if (part === 'Ctrl') return 'Control'
      return ELECTRON_KEY[part] ?? part
    })
    .join('+')
}

/** Canonical accelerator → CodeMirror keymap `key` string. */
export function toCodeMirrorKey(accel: Accelerator): string {
  return accel
    .split('+')
    .map((part) => (part.length === 1 && /[A-Za-z]/.test(part) ? part.toLowerCase() : part))
    .join('-')
}

const DISPLAY_MOD: Record<string, string> = {
  Mod: '⌘',
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧'
}
const DISPLAY_KEY: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: '⏎',
  Backspace: '⌫',
  Tab: '⇥',
  Escape: '⎋',
  ' ': 'Space'
}

/** Pretty, macOS-style display string (e.g. `⌘⇧O`). */
export function formatAccelerator(accel: Accelerator | null): string {
  if (!accel) return ''
  return accel
    .split('+')
    .map((part) => DISPLAY_MOD[part] ?? DISPLAY_KEY[part] ?? part)
    .join('')
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta'])

/**
 * Build a canonical accelerator from a keydown event (the press-to-set
 * recorder). Returns null while only modifiers are held.
 */
export function eventToAccelerator(event: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}): Accelerator | null {
  if (MODIFIER_KEYS.has(event.key)) return null

  const parts: string[] = []
  if (event.metaKey) parts.push('Mod')
  if (event.ctrlKey) parts.push(event.metaKey ? 'Ctrl' : 'Mod')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  let key = event.key
  if (key.length === 1) key = key.toUpperCase()
  // require at least one modifier OR a function key, to avoid binding bare keys
  const isFunctionKey = /^F\d{1,2}$/.test(key)
  if (parts.length === 0 && !isFunctionKey) return null

  parts.push(key)
  return parts.join('+')
}
