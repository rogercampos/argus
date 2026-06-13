import { useWorkspaceStore } from '../store'
import { EmptyState } from './ui/EmptyState'
import { SectionLabel } from './ui/SectionLabel'

/** Rails AR schema panel (spec 11): columns of the model being viewed. */
export function SchemaPanel(): React.JSX.Element {
  const schema = useWorkspaceStore((s) => s.schemaInfo)

  if (!schema) {
    return <EmptyState center>No schema for this file</EmptyState>
  }

  const openSchemaAt = (line: number): void => {
    void useWorkspaceStore.getState().navigateTo('db/schema.rb', { line })
  }

  return (
    <div className="h-full overflow-y-auto p-2">
      <SectionLabel className="px-1 pb-1">Columns ({schema.columns.length})</SectionLabel>
      {schema.columns.map((col) => (
        <button
          type="button"
          key={col.name}
          onClick={() => openSchemaAt(col.line)}
          className="focus-ring -outline-offset-2 flex w-full cursor-pointer items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-hover"
          title={`Open db/schema.rb:${col.line}`}
        >
          <span className="font-mono text-chrome text-fg">{col.name}</span>
          <span className="font-mono text-label text-fg-dim">{col.type}</span>
          {col.notNull && <span className="text-label text-fg-dim">NOT NULL</span>}
          {col.default !== null && (
            <span className="truncate text-label text-fg-dim">default: {col.default}</span>
          )}
        </button>
      ))}
      {schema.indexes.length > 0 && (
        <>
          <SectionLabel className="px-1 pt-3 pb-1">Indexes ({schema.indexes.length})</SectionLabel>
          {schema.indexes.map((index) => (
            <button
              type="button"
              key={index.line}
              onClick={() => openSchemaAt(index.line)}
              className="focus-ring -outline-offset-2 flex w-full cursor-pointer items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-hover"
            >
              <span className="truncate font-mono text-label text-fg">
                {index.columns.join(', ')}
              </span>
              {index.unique && <span className="text-label text-warning">UNIQUE</span>}
            </button>
          ))}
        </>
      )}
    </div>
  )
}
