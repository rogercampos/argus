import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Shared floating modal (spec 05): centered slightly above middle, exclusive,
 * Esc/outside-click close, edge-drag resizable with session-remembered size.
 */

const sessionSizes = new Map<string, { width: number; height: number }>()

interface ModalProps {
  id: string
  defaultWidth: number
  defaultHeight: number
  minWidth?: number
  minHeight?: number
  onClose: () => void
  children: React.ReactNode
}

const EDGE = 10

export function Modal({
  id,
  defaultWidth,
  defaultHeight,
  minWidth = 300,
  minHeight = 120,
  onClose,
  children
}: ModalProps): React.JSX.Element {
  const remembered = sessionSizes.get(id)
  const [size, setSize] = useState({
    width: remembered?.width ?? defaultWidth,
    height: remembered?.height ?? defaultHeight
  })
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    sessionSizes.set(id, size)
  }, [id, size])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const box = boxRef.current
      if (!box) return
      const rect = box.getBoundingClientRect()
      const nearRight = event.clientX > rect.right - EDGE
      const nearLeft = event.clientX < rect.left + EDGE
      const nearBottom = event.clientY > rect.bottom - EDGE
      if (!nearRight && !nearLeft && !nearBottom) return

      event.preventDefault()
      const startX = event.clientX
      const startY = event.clientY
      const startW = rect.width
      const startH = rect.height

      const onMove = (e: PointerEvent): void => {
        setSize({
          width: Math.max(
            minWidth,
            startW + (nearRight ? e.clientX - startX : nearLeft ? startX - e.clientX : 0) * 2
          ),
          height: Math.max(minHeight, startH + (nearBottom ? e.clientY - startY : 0))
        })
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [minWidth, minHeight]
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: overlay click-to-dismiss
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc handled globally above
    <div
      className="fixed inset-0 z-40 flex flex-col items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="h-[12vh] shrink-0" />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: resize handle behavior */}
      <div
        ref={boxRef}
        role="dialog"
        style={{ width: size.width, height: size.height }}
        className="flex max-h-[80vh] max-w-[95vw] cursor-default flex-col overflow-hidden rounded-md border border-edge bg-secondary shadow-[0_8px_30px_rgba(0,0,0,.4)]"
        onPointerDown={onPointerDown}
      >
        {children}
      </div>
    </div>
  )
}

/** Standard list row used by the navigation modals. */
export function ModalRow({
  selected,
  onClick,
  onActivate,
  children
}: {
  selected: boolean
  onClick: () => void
  onActivate: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  return (
    <button
      type="button"
      ref={ref}
      onClick={onClick}
      onDoubleClick={onActivate}
      className={`flex h-[25px] w-full shrink-0 cursor-pointer items-center gap-2 px-3 text-left text-[12px] ${
        selected ? 'bg-selection' : 'hover:bg-hover'
      }`}
    >
      {children}
    </button>
  )
}

/** Highlights matched character indices in a string. */
export function Highlighted({
  text,
  indices
}: {
  text: string
  indices: number[]
}): React.JSX.Element {
  if (indices.length === 0) return <span>{text}</span>
  const set = new Set(indices)
  return (
    <span>
      {text.split('').map((char, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: positional rendering of characters
          key={i}
          className={set.has(i) ? 'font-semibold text-accent' : undefined}
        >
          {char}
        </span>
      ))}
    </span>
  )
}
