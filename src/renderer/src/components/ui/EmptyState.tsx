/**
 * Consistent empty/zero-state text. `center` fills the surface and centers the
 * message (panels, previews); the default is a list-placeholder (modals).
 */
export function EmptyState({
  children,
  center = false,
  className = ''
}: {
  children: React.ReactNode
  center?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={
        center
          ? `flex h-full items-center justify-center px-4 text-center text-chrome text-fg-dim ${className}`
          : `px-3 py-4 text-chrome text-fg-dim ${className}`
      }
    >
      {children}
    </div>
  )
}
