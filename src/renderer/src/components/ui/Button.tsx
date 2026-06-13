import type { ButtonHTMLAttributes } from 'react'

/**
 * The one button used across the app. Two sizes, three variants; a single
 * primary (blue, the app accent) at most per surface, secondary/ghost for the
 * rest. Focus ring and disabled styling are baked in so every call site is
 * consistent and accessible.
 */

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-button-primary text-on-accent hover:opacity-90',
  secondary: 'border border-edge bg-secondary text-fg hover:bg-hover',
  ghost: 'text-fg-dim hover:bg-hover hover:text-fg'
}

const SIZES: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-label',
  md: 'px-3 py-1.5 text-chrome'
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className = '',
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={`cursor-pointer rounded font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    />
  )
}
