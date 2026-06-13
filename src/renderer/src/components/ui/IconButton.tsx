import type { ButtonHTMLAttributes } from 'react'

/**
 * Compact glyph/icon button for chrome affordances (reveal, re-run, clear,
 * close…). Ghost styling with a consistent hover + focus ring. Pass the size
 * (e.g. `size-6`) and the glyph/SVG as children; always provide a `title`.
 */
export function IconButton({
  type = 'button',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button
      type={type}
      className={`flex cursor-pointer items-center justify-center rounded text-fg-dim outline-none hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${className}`}
      {...props}
    />
  )
}
