import { sortPathsForTree } from './treeSort'

/**
 * Tree-order sorting off the UI thread: sorting ~100k paths takes hundreds
 * of ms and would block the renderer on every full tree rebuild. Stale
 * answers are discarded by the caller via the request id.
 */

interface SortMessage {
  id: number
  paths: string[]
  starred: string[]
}

self.onmessage = (event: MessageEvent<SortMessage>) => {
  const { id, paths, starred } = event.data
  const sorted = sortPathsForTree(paths, new Set(starred))
  ;(self as unknown as Worker).postMessage({ id, sorted })
}
