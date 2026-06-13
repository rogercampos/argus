import { forwardRef, type InputHTMLAttributes } from 'react'

/**
 * The shared text input (modal search fields, line picker, replace field).
 * Monospace, dark fill, and — crucially — a visible inset focus ring so
 * keyboard focus is never invisible. Falls back to the placeholder for its
 * accessible name when no `aria-label` is given.
 */
export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ type = 'text', className = '', placeholder, ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        placeholder={placeholder}
        aria-label={props['aria-label'] ?? placeholder}
        className={`rounded border border-edge bg-primary px-3 py-1.5 font-mono text-body text-fg outline-none placeholder:text-fg-dim focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent ${className}`}
        {...props}
      />
    )
  }
)
