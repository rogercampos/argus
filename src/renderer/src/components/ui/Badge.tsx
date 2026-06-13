/** Small inline tag/pill (symbol kinds, project kinds, "Rails"…). */
const TONES = {
  neutral: 'bg-hover text-fg-dim',
  error: 'bg-error/20 text-error'
} as const

export function Badge({
  tone = 'neutral',
  className = '',
  children
}: {
  tone?: keyof typeof TONES
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span className={`shrink-0 rounded px-1.5 text-label ${TONES[tone]} ${className}`}>
      {children}
    </span>
  )
}
