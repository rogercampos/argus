import { useWorkspaceStore } from '../store'

/** Rails AR schema panel (spec 11): columns of the model being viewed. */
export function SchemaPanel(): React.JSX.Element {
  const schema = useWorkspaceStore((s) => s.schemaInfo)

  if (!schema) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-fg-dim">
        No schema for this file
      </div>
    )
  }

  const openSchemaAt = (line: number): void => {
    void useWorkspaceStore.getState().navigateTo('db/schema.rb', { line })
  }

  return (
    <div className="h-full overflow-y-auto p-2">
      <div className="px-1 pb-1 text-[11px] font-semibold tracking-wider text-fg-dim uppercase">
        Columns ({schema.columns.length})
      </div>
      {schema.columns.map((col) => (
        <button
          type="button"
          key={col.name}
          onClick={() => openSchemaAt(col.line)}
          className="flex w-full cursor-pointer items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-hover"
          title={`Open db/schema.rb:${col.line}`}
        >
          <span className="font-mono text-[12px] text-fg">{col.name}</span>
          <span className="font-mono text-[11px] text-fg-dim">{col.type}</span>
          {col.notNull && <span className="text-[9px] text-fg-dim">NOT NULL</span>}
          {col.default !== null && (
            <span className="truncate text-[9px] text-fg-dim">default: {col.default}</span>
          )}
        </button>
      ))}
      {schema.indexes.length > 0 && (
        <>
          <div className="px-1 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-fg-dim uppercase">
            Indexes ({schema.indexes.length})
          </div>
          {schema.indexes.map((index) => (
            <button
              type="button"
              key={index.line}
              onClick={() => openSchemaAt(index.line)}
              className="flex w-full cursor-pointer items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-hover"
            >
              <span className="truncate font-mono text-[11px] text-fg">
                {index.columns.join(', ')}
              </span>
              {index.unique && <span className="text-[9px] text-warning">UNIQUE</span>}
            </button>
          ))}
        </>
      )}
    </div>
  )
}
