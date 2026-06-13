/**
 * On/off switch. State is driven entirely by the native checkbox via CSS
 * `has-*`/`group-has-*` variants (no JS class toggling); the track turns the
 * blue accent when checked and the thumb slides. Always-dark, so the dark
 * palette values are the base.
 */
export function Toggle({
  checked,
  onChange,
  label,
  id
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  id?: string
}): React.JSX.Element {
  return (
    <span className="group relative inline-flex w-9 shrink-0 rounded-full bg-hover p-0.5 inset-ring inset-ring-white/10 outline-accent outline-offset-2 transition-colors duration-200 ease-in-out has-checked:bg-button-primary has-focus-visible:outline-2">
      <span className="aspect-square w-1/2 rounded-full bg-fg shadow-xs transition-transform duration-200 ease-in-out group-has-checked:translate-x-full" />
      <input
        id={id}
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
        className="absolute inset-0 size-full cursor-pointer appearance-none rounded-full focus:outline-hidden"
      />
    </span>
  )
}
