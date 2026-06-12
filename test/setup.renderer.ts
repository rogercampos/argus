import '@testing-library/jest-dom/vitest'

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

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
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
