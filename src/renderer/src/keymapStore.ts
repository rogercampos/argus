import { create } from 'zustand'
import {
  type Accelerator,
  defaultKeymapConfig,
  effectiveBindings,
  type KeymapConfig,
  type ShortcutCommandId,
  type ShortcutTemplateId
} from '../../shared/shortcuts'

/**
 * Renderer-side keyboard shortcut state. Holds the persisted config (template +
 * overrides) and the resolved bindings used by the editor keymap and Settings
 * UI. Every change persists (which also rebuilds the native menu in main) and
 * notifies subscribers so open editors can re-bind live.
 */

const listeners = new Set<() => void>()
/** Subscribe to effective-binding changes (the editor uses this to reconfigure). */
export function onKeymapChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function notify(): void {
  for (const l of listeners) l()
}

interface KeymapStore {
  config: KeymapConfig
  bindings: Record<ShortcutCommandId, Accelerator | null>
  init: () => Promise<void>
  /** Apply a whole template — clears per-command overrides (spec: templates set
   * ALL shortcuts to that editor's). */
  setTemplate: (template: ShortcutTemplateId) => void
  setOverride: (id: ShortcutCommandId, accel: Accelerator | null) => void
  resetOverride: (id: ShortcutCommandId) => void
}

export const useKeymapStore = create<KeymapStore>((set, get) => {
  const apply = (config: KeymapConfig): void => {
    set({ config, bindings: effectiveBindings(config) })
    void window.api.saveKeymap(config)
    notify()
  }

  return {
    config: defaultKeymapConfig(),
    bindings: effectiveBindings(defaultKeymapConfig()),

    init: async () => {
      const config = await window.api.loadKeymap()
      set({ config, bindings: effectiveBindings(config) })
      notify()
    },

    setTemplate: (template) => apply({ template, overrides: {} }),

    setOverride: (id, accel) =>
      apply({ ...get().config, overrides: { ...get().config.overrides, [id]: accel } }),

    resetOverride: (id) => {
      const overrides = { ...get().config.overrides }
      delete overrides[id]
      apply({ ...get().config, overrides })
    }
  }
})
