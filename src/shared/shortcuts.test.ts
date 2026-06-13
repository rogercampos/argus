import { describe, expect, it } from 'vitest'
import {
  defaultKeymapConfig,
  effectiveBindings,
  eventToAccelerator,
  formatAccelerator,
  SHORTCUT_COMMANDS,
  TEMPLATE_BINDINGS,
  toCodeMirrorKey,
  toElectronAccelerator
} from './shortcuts'

describe('accelerator converters', () => {
  it('converts to Electron accelerators', () => {
    expect(toElectronAccelerator('Mod+Shift+O')).toBe('CmdOrCtrl+Shift+O')
    expect(toElectronAccelerator('Alt+Shift+ArrowUp')).toBe('Alt+Shift+Up')
    expect(toElectronAccelerator('Mod+Alt+ArrowLeft')).toBe('CmdOrCtrl+Alt+Left')
    expect(toElectronAccelerator('Mod+/')).toBe('CmdOrCtrl+/')
  })

  it('converts to CodeMirror keys', () => {
    expect(toCodeMirrorKey('Mod+D')).toBe('Mod-d')
    expect(toCodeMirrorKey('Alt+Shift+ArrowUp')).toBe('Alt-Shift-ArrowUp')
    expect(toCodeMirrorKey('Mod+Backspace')).toBe('Mod-Backspace')
    expect(toCodeMirrorKey('Shift+F6')).toBe('Shift-F6')
    expect(toCodeMirrorKey('Mod+/')).toBe('Mod-/')
  })

  it('formats for display', () => {
    expect(formatAccelerator('Mod+Shift+O')).toBe('⌘⇧O')
    expect(formatAccelerator('Alt+ArrowUp')).toBe('⌥↑')
    expect(formatAccelerator(null)).toBe('')
  })
})

describe('eventToAccelerator', () => {
  const ev = (over: Partial<KeyboardEvent>): KeyboardEvent =>
    ({
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      key: 'a',
      ...over
    }) as KeyboardEvent

  it('builds from modifiers + key', () => {
    expect(eventToAccelerator(ev({ metaKey: true, key: 'p' }))).toBe('Mod+P')
    expect(eventToAccelerator(ev({ metaKey: true, shiftKey: true, key: 'o' }))).toBe('Mod+Shift+O')
    expect(eventToAccelerator(ev({ altKey: true, shiftKey: true, key: 'ArrowUp' }))).toBe(
      'Alt+Shift+ArrowUp'
    )
  })

  it('ignores modifier-only presses and bare keys', () => {
    expect(eventToAccelerator(ev({ key: 'Shift', shiftKey: true }))).toBeNull()
    expect(eventToAccelerator(ev({ key: 'a' }))).toBeNull() // no modifier
  })

  it('allows function keys with no modifier', () => {
    expect(eventToAccelerator(ev({ key: 'F6' }))).toBe('F6')
  })
})

describe('effectiveBindings', () => {
  it('resolves template defaults, overrides, and explicit unbinding', () => {
    const base = effectiveBindings(defaultKeymapConfig())
    expect(base.save).toBe('Mod+S')
    expect(base['go-to-file']).toBe('Mod+Shift+O')

    const customized = effectiveBindings({
      template: 'rubymine',
      overrides: { save: 'Mod+Alt+S', 'go-to-file': null }
    })
    expect(customized.save).toBe('Mod+Alt+S')
    expect(customized['go-to-file']).toBeNull()
  })
})

describe('templates are conflict-free', () => {
  for (const template of ['rubymine', 'vscode', 'sublime'] as const) {
    it(`${template} binds each accelerator at most once`, () => {
      const bindings = effectiveBindings({ template, overrides: {} })
      const seen = new Map<string, string>()
      for (const cmd of SHORTCUT_COMMANDS) {
        const accel = bindings[cmd.id]
        if (!accel) continue
        expect(seen.has(accel), `${accel} reused by ${cmd.id} and ${seen.get(accel)}`).toBe(false)
        seen.set(accel, cmd.id)
      }
    })
  }

  it('every template binding refers to a known command', () => {
    const ids = new Set(SHORTCUT_COMMANDS.map((c) => c.id))
    for (const map of Object.values(TEMPLATE_BINDINGS)) {
      for (const id of Object.keys(map)) expect(ids.has(id as never)).toBe(true)
    }
  })
})
