import { useCallback, useEffect, useState } from 'react'
import type { LspLocation } from '../../../shared/types'
import { useWorkspaceStore } from '../store'

/** Ruby gem/stdlib paths shortened for readability (spec 05). */
export function shortenRubyPath(path: string): string {
  const gemMatch = /gems\/([^/]+)\/(.*)$/.exec(path)
  if (gemMatch) return `(${gemMatch[1]}) ${gemMatch[2]}`
  const rubyMatch = /rubies\/ruby-([\d.]+)[^/]*\/(.*)$/.exec(path)
  if (rubyMatch) return `(ruby ${rubyMatch[1]}) ${rubyMatch[2]}`
  return path
}

/** Picker shown when go-to-definition returns multiple locations (spec 05). */
export function DefinitionPicker({ choices }: { choices: LspLocation[] }): React.JSX.Element {
  const [selected, setSelected] = useState(0)

  const close = useCallback((): void => {
    useWorkspaceStore.setState({ definitionChoices: null })
  }, [])

  const open = useCallback(
    (loc: LspLocation): void => {
      close()
      void useWorkspaceStore
        .getState()
        .navigateTo(loc.path, { line: loc.line + 1, col: loc.character + 1 })
    },
    [close]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected((s) => (s + 1) % choices.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected((s) => (s - 1 + choices.length) % choices.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        open(choices[selected])
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [choices, selected, close, open])

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: overlay dismiss
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc handled globally
    <div
      className="fixed inset-0 z-40"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="absolute top-1/3 left-1/2 w-150 max-w-[90vw] -translate-x-1/2 rounded-md border border-edge bg-secondary py-1 shadow-popover">
        <div className="px-3 py-1 text-label font-semibold text-fg-dim">
          {choices.length} definitions
        </div>
        {choices.map((loc, index) => (
          <button
            type="button"
            key={`${loc.path}:${loc.line}`}
            onClick={() => open(loc)}
            className={`flex w-full cursor-pointer items-baseline gap-2 px-3 py-1 text-left ${
              index === selected ? 'bg-selection' : 'hover:bg-hover'
            }`}
          >
            <span
              className="truncate font-mono text-chrome"
              style={{ direction: 'rtl', textAlign: 'left' }}
            >
              {`‎${shortenRubyPath(loc.path)}`}
            </span>
            <span className="ml-auto shrink-0 font-mono text-label text-fg-dim">
              :{loc.line + 1}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
