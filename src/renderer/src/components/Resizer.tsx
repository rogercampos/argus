import { useCallback, useRef } from 'react'

interface ResizerProps {
  direction: 'horizontal' | 'vertical'
  /** Called with the pointer delta since drag start; consumer applies it. */
  onDrag: (delta: number) => void
}

/** Invisible drag handle between panels. */
export function Resizer({ direction, onDrag }: ResizerProps): React.JSX.Element {
  const start = useRef(0)

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      start.current = direction === 'horizontal' ? event.clientX : event.clientY
      const target = event.currentTarget
      target.setPointerCapture(event.pointerId)

      const onMove = (e: PointerEvent): void => {
        const pos = direction === 'horizontal' ? e.clientX : e.clientY
        onDrag(pos - start.current)
        start.current = pos
      }
      const onUp = (): void => {
        target.removeEventListener('pointermove', onMove)
        target.removeEventListener('pointerup', onUp)
      }
      target.addEventListener('pointermove', onMove)
      target.addEventListener('pointerup', onUp)
    },
    [direction, onDrag]
  )

  return (
    <div
      onPointerDown={onPointerDown}
      className={
        direction === 'horizontal'
          ? 'w-1.5 shrink-0 cursor-col-resize'
          : 'h-1.5 shrink-0 cursor-row-resize'
      }
    />
  )
}
