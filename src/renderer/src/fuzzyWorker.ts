import { rankPaths } from './fuzzy'

/**
 * Fuzzy filtering off the UI thread (spec 04). Holds the workspace path
 * list; answers queries by id — stale answers are discarded by the caller.
 */

let paths: string[] = []

interface SetMessage {
  type: 'set'
  paths: string[]
}

interface QueryMessage {
  type: 'query'
  id: number
  query: string
  recents: string[]
  limit: number
}

self.onmessage = (event: MessageEvent<SetMessage | QueryMessage>) => {
  const msg = event.data
  if (msg.type === 'set') {
    paths = msg.paths
    return
  }
  const { items, total } = rankPaths(msg.query, paths, msg.recents, msg.limit)
  self.postMessage({ type: 'result', id: msg.id, items, total })
}
