import { useWorkspaceStore } from '../store'

export function TitleBar(): React.JSX.Element {
  const rootName = useWorkspaceStore((s) => s.rootName)

  return (
    <header className="drag-region flex h-9.5 shrink-0 items-center pr-3 pl-20">
      <span className="text-[13px] font-semibold text-fg">{rootName}</span>
      {/* Git branch indicator mounts here in stage 5 */}
    </header>
  )
}
