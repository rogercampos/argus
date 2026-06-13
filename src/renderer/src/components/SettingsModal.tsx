import { useCallback, useState } from 'react'
import {
  SHORTCUT_COMMANDS,
  SHORTCUT_TEMPLATES,
  type ShortcutCategory
} from '../../../shared/shortcuts'
import { DEFAULT_EXCLUDED_PATHS } from '../../../shared/types'
import { useKeymapStore } from '../keymapStore'
import { useWorkspaceStore } from '../store'
import { Modal, ModalHeader } from './Modal'
import { Button } from './ui/Button'
import { EmptyState } from './ui/EmptyState'
import { IconButton } from './ui/IconButton'
import { KeyRecorder } from './ui/KeyRecorder'
import { SectionLabel } from './ui/SectionLabel'
import { TextInput } from './ui/TextInput'
import { Toggle } from './ui/Toggle'

type Section = 'general' | 'keyboard' | 'rails'
const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'rails', label: 'Rails' }
]

/** Workspace settings (Cmd+,): excluded paths + Rails schema auto-open. */
export function SettingsModal(): React.JSX.Element {
  const [section, setSection] = useState<Section>('general')

  const close = useCallback((): void => {
    useWorkspaceStore.setState({ openModal: null })
  }, [])

  return (
    <Modal id="settings" defaultWidth={720} defaultHeight={480} minWidth={520} onClose={close}>
      <ModalHeader>Settings</ModalHeader>
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-edge p-2">
          {SECTIONS.map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`focus-ring -outline-offset-2 cursor-pointer rounded px-2 py-1.5 text-left text-chrome ${
                section === s.id ? 'bg-hover text-fg' : 'text-fg-dim hover:bg-hover hover:text-fg'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {section === 'general' && <GeneralSection />}
          {section === 'keyboard' && <KeyboardSection />}
          {section === 'rails' && <RailsSection />}
        </div>
      </div>
    </Modal>
  )
}

/** General → excluded paths (per workspace). */
function GeneralSection(): React.JSX.Element {
  const excludedPaths = useWorkspaceStore((s) => s.excludedPaths)
  const setExcludedPaths = useWorkspaceStore((s) => s.setExcludedPaths)
  const [draft, setDraft] = useState('')

  const add = (): void => {
    const value = draft.trim().replace(/^\/+|\/+$/g, '')
    setDraft('')
    if (!value || excludedPaths.includes(value)) return
    setExcludedPaths([...excludedPaths, value])
  }

  const sorted = [...excludedPaths].sort()

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-chrome text-fg">Excluded paths</div>
        <p className="mt-0.5 text-label text-fg-dim text-pretty">
          Files and folders under these paths are dimmed in the tree, hidden from Go to File, and
          skipped by search. Scoped to this workspace.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <TextInput
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="e.g. coverage or app/assets/builds"
          className="min-w-0 flex-1"
        />
        <Button variant="secondary" size="sm" onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>

      {sorted.length === 0 ? (
        <EmptyState>No excluded paths.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-1">
          {sorted.map((path) => (
            <li
              key={path}
              className="flex items-center gap-2 rounded border border-edge bg-primary/40 py-1 pr-1 pl-2.5"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-chrome text-fg">{path}</span>
              <IconButton
                title={`Remove ${path}`}
                onClick={() => setExcludedPaths(excludedPaths.filter((p) => p !== path))}
                className="size-6 hover:text-error"
              >
                ×
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExcludedPaths([...DEFAULT_EXCLUDED_PATHS])}
        >
          Restore defaults
        </Button>
      </div>
    </div>
  )
}

/** Keyboard → preset templates + per-command, press-to-set shortcuts. */
function KeyboardSection(): React.JSX.Element {
  const config = useKeymapStore((s) => s.config)
  const bindings = useKeymapStore((s) => s.bindings)
  const setTemplate = useKeymapStore((s) => s.setTemplate)
  const setOverride = useKeymapStore((s) => s.setOverride)
  const resetOverride = useKeymapStore((s) => s.resetOverride)

  // flag any accelerator bound to more than one command
  const counts = new Map<string, number>()
  for (const cmd of SHORTCUT_COMMANDS) {
    const accel = bindings[cmd.id]
    if (accel) counts.set(accel, (counts.get(accel) ?? 0) + 1)
  }

  const categories: ShortcutCategory[] = []
  for (const cmd of SHORTCUT_COMMANDS) {
    if (!categories.includes(cmd.category)) categories.push(cmd.category)
  }

  const overrideCount = Object.keys(config.overrides).length

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-chrome text-fg">Preset</div>
        <p className="mt-0.5 text-label text-fg-dim text-pretty">
          Apply a complete keymap from a major editor, then tweak individual shortcuts below.
          Changing a shortcut applies everywhere immediately.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SHORTCUT_TEMPLATES.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant={config.template === t.id ? 'primary' : 'secondary'}
              onClick={() => setTemplate(t.id)}
            >
              {t.label}
            </Button>
          ))}
        </div>
        {overrideCount > 0 && (
          <p className="mt-1 text-label text-fg-dim">
            {overrideCount} custom override{overrideCount === 1 ? '' : 's'} on top of the preset.
          </p>
        )}
      </div>

      {categories.map((category) => (
        <div key={category} className="flex flex-col gap-0.5">
          <SectionLabel className="pb-0.5">{category}</SectionLabel>
          {SHORTCUT_COMMANDS.filter((c) => c.category === category).map((cmd) => {
            const accel = bindings[cmd.id]
            const overridden = config.overrides[cmd.id] !== undefined
            const conflict = accel ? (counts.get(accel) ?? 0) > 1 : false
            return (
              <div key={cmd.id} className="flex items-center gap-2 py-0.5">
                <span className="min-w-0 flex-1 truncate text-chrome text-fg">{cmd.label}</span>
                {overridden && (
                  <IconButton
                    title="Reset to preset"
                    onClick={() => resetOverride(cmd.id)}
                    className="size-6"
                  >
                    ↺
                  </IconButton>
                )}
                <KeyRecorder
                  value={accel}
                  conflict={conflict}
                  onCapture={(a) => setOverride(cmd.id, a)}
                />
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** Rails → auto-open the AR schema panel. */
function RailsSection(): React.JSX.Element {
  const railsAutoSchema = useWorkspaceStore((s) => s.railsAutoSchema)
  const setRailsAutoSchema = useWorkspaceStore((s) => s.setRailsAutoSchema)

  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor="rails-auto-schema"
        className="flex cursor-pointer items-start justify-between gap-4"
      >
        <span className="min-w-0">
          <span className="block text-chrome text-fg">Auto-open schema panel</span>
          <span className="mt-0.5 block text-label text-fg-dim text-pretty">
            When you open a Rails Active Record model (<code>app/models/*.rb</code>), reveal its
            table columns and indexes in the right panel automatically.
          </span>
        </span>
        <Toggle
          id="rails-auto-schema"
          checked={railsAutoSchema}
          onChange={setRailsAutoSchema}
          label="Auto-open schema panel"
        />
      </label>
    </div>
  )
}
