import { relative, sep } from 'node:path'
import watcher, { type AsyncSubscription } from '@parcel/watcher'
import type { BrowserWindow } from 'electron'
import type { WatchEvent } from '../shared/types'
import { gitMonitorFor } from './git'

/**
 * Workspace file watching (spec 06/07): keeps open documents and the file
 * tree live. One subscription per workspace window.
 */

const subscriptions = new Map<number, AsyncSubscription>()

export async function startWatching(window: BrowserWindow, root: string): Promise<void> {
  if (subscriptions.has(window.id)) return

  const subscription = await watcher.subscribe(
    root,
    (error, events) => {
      if (error || window.isDestroyed()) return
      const mapped: WatchEvent[] = []
      const allRelPaths: string[] = []
      for (const event of events) {
        const rel = relative(root, event.path).split(sep).join('/')
        allRelPaths.push(rel)
        // .git internals are handled by the git monitor, not the renderer
        if (rel.startsWith('.git/') || rel === '.git') continue
        mapped.push({ type: event.type, relPath: rel })
      }
      gitMonitorFor(window.id)?.noteChanges(allRelPaths)
      if (mapped.length > 0) {
        window.webContents.send('watch:events', mapped)
      }
    },
    { ignore: ['node_modules', '.git/objects'] }
  )

  subscriptions.set(window.id, subscription)
  window.on('closed', () => {
    void subscription.unsubscribe()
    subscriptions.delete(window.id)
  })
}
