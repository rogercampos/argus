/**
 * Floating status toast. `info` is transient and non-interactive (auto-dismissed
 * by the caller); `error` is red and click-to-dismiss with a visible ✕
 * affordance. Positioning is supplied by the caller via `className`.
 */
export function Toast({
  variant = 'info',
  onDismiss,
  className = '',
  children
}: {
  variant?: 'info' | 'error'
  onDismiss?: () => void
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  const tone = variant === 'error' ? 'text-error' : 'text-fg-dim'
  const base = `flex items-center gap-2 rounded-md border border-edge bg-secondary px-3 py-1.5 text-chrome shadow-toast ${tone} ${className}`

  if (!onDismiss) {
    return <div className={base}>{children}</div>
  }
  return (
    <button
      type="button"
      onClick={onDismiss}
      title="Dismiss"
      className={`cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${base}`}
    >
      <span>{children}</span>
      <span aria-hidden="true" className="text-fg-dim">
        ✕
      </span>
    </button>
  )
}
