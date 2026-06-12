import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Resizer } from './Resizer'

function drag(
  element: HTMLElement,
  moves: Array<{ x: number; y: number }>,
  start = { x: 100, y: 100 }
): void {
  fireEvent.pointerDown(element, { clientX: start.x, clientY: start.y, pointerId: 1 })
  for (const move of moves) {
    fireEvent.pointerMove(element, { clientX: move.x, clientY: move.y, pointerId: 1 })
  }
  fireEvent.pointerUp(element, { pointerId: 1 })
}

describe('Resizer', () => {
  it('reports horizontal deltas relative to the last position', () => {
    const deltas: number[] = []
    const { container } = render(<Resizer direction="horizontal" onDrag={(d) => deltas.push(d)} />)
    const handle = container.firstElementChild as HTMLElement

    drag(handle, [
      { x: 110, y: 100 },
      { x: 105, y: 250 } // vertical movement is ignored
    ])
    expect(deltas).toEqual([10, -5])
  })

  it('reports vertical deltas for vertical resizers', () => {
    const deltas: number[] = []
    const { container } = render(<Resizer direction="vertical" onDrag={(d) => deltas.push(d)} />)
    const handle = container.firstElementChild as HTMLElement

    drag(handle, [{ x: 300, y: 130 }])
    expect(deltas).toEqual([30])
  })

  it('stops reporting after pointer up', () => {
    const deltas: number[] = []
    const { container } = render(<Resizer direction="horizontal" onDrag={(d) => deltas.push(d)} />)
    const handle = container.firstElementChild as HTMLElement

    drag(handle, [{ x: 120, y: 100 }])
    fireEvent.pointerMove(handle, { clientX: 200, clientY: 100, pointerId: 1 })
    expect(deltas).toEqual([20])
  })
})
