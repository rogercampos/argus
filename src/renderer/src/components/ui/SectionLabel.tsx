/**
 * Uppercase eyebrow label used for panel/modal section headers (Columns,
 * Projects, Start, Recent…). Monospace per the design rule for uppercase
 * micro-labels; padding is left to the caller via `className`.
 */
export function SectionLabel({
  children,
  className = ''
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={`font-mono text-label font-semibold tracking-wider text-fg-dim uppercase ${className}`}
    >
      {children}
    </div>
  )
}
