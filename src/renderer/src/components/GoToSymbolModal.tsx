import { useCallback, useEffect, useRef, useState } from 'react'
import type { LspSymbol } from '../../../shared/types'
import { useWorkspaceStore } from '../store'
import { Modal, ModalRow, ModalSearchInput } from './Modal'
import { PathTail } from './PathTail'
import { Badge } from './ui/Badge'
import { EmptyState } from './ui/EmptyState'

const SYMBOL_KIND_LABELS: Record<number, string> = {
  5: 'class',
  6: 'method',
  7: 'property',
  8: 'field',
  9: 'ctor',
  10: 'enum',
  11: 'interface',
  12: 'function',
  13: 'variable',
  14: 'const',
  23: 'struct',
  2: 'module',
  3: 'namespace'
}

/** Go to Symbol (Cmd+O, spec 05): LSP workspace symbols, 150ms debounce. */
export function GoToSymbolModal(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [symbols, setSymbols] = useState<LspSymbol[]>([])
  const [selected, setSelected] = useState(0)
  const revRef = useRef(0)

  const close = useCallback((): void => {
    useWorkspaceStore.setState({ openModal: null })
  }, [])

  useEffect(() => {
    const rev = ++revRef.current
    const timer = setTimeout(() => {
      void window.api.lspWorkspaceSymbols(query).then((result) => {
        if (revRef.current !== rev) return // stale
        setSymbols(result)
        setSelected(0)
      })
    }, 150)
    return () => clearTimeout(timer)
  }, [query])

  const open = useCallback(
    (symbol: LspSymbol): void => {
      close()
      void useWorkspaceStore.getState().navigateTo(symbol.location.path, {
        line: symbol.location.line + 1,
        col: symbol.location.character + 1
      })
    },
    [close]
  )

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => (symbols.length === 0 ? 0 : (s + 1) % symbols.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => (symbols.length === 0 ? 0 : (s - 1 + symbols.length) % symbols.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const symbol = symbols[selected]
      if (symbol) open(symbol)
    }
  }

  return (
    <Modal id="go-to-symbol" defaultWidth={800} defaultHeight={600} onClose={close}>
      <ModalSearchInput
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Type a symbol name…"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {symbols.map((symbol, index) => (
          <ModalRow
            key={`${symbol.location.path}:${symbol.location.line}:${symbol.name}`}
            selected={index === selected}
            onClick={() => open(symbol)}
            onActivate={() => open(symbol)}
          >
            <Badge>{SYMBOL_KIND_LABELS[symbol.kind] ?? 'sym'}</Badge>
            <span className="truncate">{symbol.name}</span>
            {symbol.containerName && (
              <span className="truncate text-label text-fg-dim">{symbol.containerName}</span>
            )}
            <PathTail
              text={symbol.location.path}
              className="ml-auto truncate pl-4 font-mono text-label text-fg-dim"
            />
          </ModalRow>
        ))}
        {symbols.length === 0 && query && (
          <EmptyState>No symbols (is a language server running for this project?)</EmptyState>
        )}
      </div>
    </Modal>
  )
}
