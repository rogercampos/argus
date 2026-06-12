/**
 * A path label that truncates at the START, keeping the tail visible — in
 * deep repos the end of the path is the informative part. RTL direction
 * places the ellipsis on the left; the LRM guards keep the LTR segments and
 * slashes in their normal visual order.
 */
export function PathTail({
  text,
  className
}: {
  text: string
  className: string
}): React.JSX.Element {
  return (
    <span dir="rtl" className={className}>
      {'‎'}
      {text}
      {'‎'}
    </span>
  )
}
