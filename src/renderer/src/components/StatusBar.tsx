import { useWorkspaceStore } from '../store'

export function StatusBar(): React.JSX.Element {
  const cursor = useWorkspaceStore((s) => s.cursor)
  const language = useWorkspaceStore((s) => s.language)

  return (
    <footer className="flex h-[25px] shrink-0 items-center gap-4 rounded-md border border-edge bg-secondary px-3 text-[11px] text-fg-dim">
      {/* Diagnostics summary + background tasks mount here in later stages */}
      <div className="flex-1" />
      {cursor && (
        <button
          type="button"
          onClick={() => useWorkspaceStore.getState().setModal('go-to-line')}
          className="cursor-pointer hover:text-fg"
        >
          {cursor.line}:{cursor.col}
        </button>
      )}
      {language && <span>{language}</span>}
    </footer>
  )
}
