import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// auto-cleanup needs vitest globals, which this project doesn't enable
afterEach(() => cleanup())

/**
 * jsdom is missing several layout/observer APIs that CodeMirror's EditorView
 * requires to mount. These shims return zero-geometry — fine for logic tests;
 * anything pixel-dependent belongs in E2E.
 */

const zeroRect = (): DOMRect => ({
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  bottom: 0,
  right: 0,
  width: 0,
  height: 0,
  toJSON: () => ({})
})

if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects = function getClientRects() {
    const rects = [zeroRect()]
    return Object.assign(rects, {
      item: (i: number) => rects[i] ?? null
    }) as unknown as DOMRectList
  }
  Range.prototype.getBoundingClientRect = zeroRect
}

// jsdom does no layout: report a plausible fixed size so virtualized lists
// (the file tree) render rows instead of nothing
const FAKE_WIDTH = 1024
const FAKE_HEIGHT = 768

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    private callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }
    observe(target: Element): void {
      this.callback(
        [
          {
            target,
            contentRect: {
              ...zeroRect(),
              width: FAKE_WIDTH,
              height: FAKE_HEIGHT,
              right: FAKE_WIDTH,
              bottom: FAKE_HEIGHT
            },
            borderBoxSize: [{ blockSize: FAKE_HEIGHT, inlineSize: FAKE_WIDTH }],
            contentBoxSize: [{ blockSize: FAKE_HEIGHT, inlineSize: FAKE_WIDTH }],
            devicePixelContentBoxSize: [{ blockSize: FAKE_HEIGHT, inlineSize: FAKE_WIDTH }]
          } as unknown as ResizeObserverEntry
        ],
        this as unknown as ResizeObserver
      )
    }
    unobserve(): void {}
    disconnect(): void {}
  }
}

if (typeof HTMLElement !== 'undefined') {
  const original = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    const rect = original.call(this)
    // jsdom always reports zeros; pretend every element has a real box
    if (rect.width === 0 && rect.height === 0) {
      return {
        ...zeroRect(),
        width: FAKE_WIDTH,
        height: FAKE_HEIGHT,
        right: FAKE_WIDTH,
        bottom: FAKE_HEIGHT
      }
    }
    return rect
  }
}

if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    }) as MediaQueryList
}

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

if (typeof Element !== 'undefined' && !Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}

if (typeof navigator !== 'undefined' && !navigator.clipboard) {
  const clipboardWrites: string[] = []
  Object.defineProperty(navigator, 'clipboard', {
    // userEvent.setup() replaces this with its own stub — stay configurable
    configurable: true,
    value: {
      writeText: (text: string): Promise<void> => {
        clipboardWrites.push(text)
        return Promise.resolve()
      },
      /** test hook */
      __writes: clipboardWrites
    }
  })
}

/**
 * jsdom has no Worker. The app's two workers are thin postMessage wrappers
 * around pure modules; this shim speaks the same protocols but calls the REAL
 * fuzzy/treeSort code synchronously-on-microtask in-process.
 */
type AnyMessage = Record<string, unknown>

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  private listeners = new Set<(event: { data: unknown }) => void>()
  private kind: 'fuzzy' | 'treeSort'
  private paths: string[] = []

  constructor(url: URL | string) {
    const spec = String(url)
    if (spec.includes('fuzzyWorker')) this.kind = 'fuzzy'
    else if (spec.includes('treeSortWorker')) this.kind = 'treeSort'
    else throw new Error(`FakeWorker: unknown worker module ${spec}`)
  }

  private emit(data: unknown): void {
    this.onmessage?.({ data })
    for (const listener of this.listeners) listener({ data })
  }

  postMessage(message: AnyMessage): void {
    void (async () => {
      if (this.kind === 'fuzzy') {
        if (message.type === 'set') {
          this.paths = message.paths as string[]
          return
        }
        const { rankPaths } = await import('../src/renderer/src/fuzzy')
        const { items, total } = rankPaths(
          message.query as string,
          this.paths,
          message.recents as string[],
          message.limit as number
        )
        this.emit({ type: 'result', id: message.id, items, total })
      } else {
        const { sortPathsForTree } = await import('../src/renderer/src/treeSort')
        const sorted = sortPathsForTree(
          message.paths as string[],
          new Set(message.starred as string[])
        )
        this.emit({ id: message.id, sorted })
      }
    })()
  }

  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    if (type === 'message') this.listeners.add(listener)
  }
  removeEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    if (type === 'message') this.listeners.delete(listener)
  }
  terminate(): void {
    this.onmessage = null
    this.listeners.clear()
  }
}

;(globalThis as { Worker?: unknown }).Worker = FakeWorker
