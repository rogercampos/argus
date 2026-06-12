import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StubBrowserWindow } from '../../test/electronStub'
import type { WatchEvent } from '../shared/types'
import { startWatching } from './watcher'

/** Real @parcel/watcher subscriptions on temp dirs. */
describe('file watching (spec 06/07)', () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup()
  })

  async function watchedDir(makeRoot?: (real: string) => string): Promise<{
    root: string
    events: () => WatchEvent[]
  }> {
    const real = realpathSync(mkdtempSync(join(tmpdir(), 'argus-watch-')))
    const root = makeRoot ? makeRoot(real) : real
    const stub = new StubBrowserWindow()
    await startWatching(stub as unknown as BrowserWindow, root)
    cleanups.push(() => {
      stub.close() // unsubscribes the watcher
      rmSync(real, { recursive: true, force: true })
    })
    return {
      root,
      events: () =>
        stub.webContents.sent
          .filter((m) => m.channel === 'watch:events')
          .flatMap((m) => m.args[0] as WatchEvent[])
    }
  }

  it('streams create, update, and delete events with workspace-relative paths', async () => {
    const { root, events } = await watchedDir()
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/a.ts'), 'one\n')
    await vi.waitFor(
      () => expect(events()).toContainEqual({ type: 'create', relPath: 'src/a.ts' }),
      { timeout: 5000 }
    )

    writeFileSync(join(root, 'src/a.ts'), 'two\n')
    await vi.waitFor(
      () => expect(events()).toContainEqual({ type: 'update', relPath: 'src/a.ts' }),
      { timeout: 5000 }
    )

    rmSync(join(root, 'src/a.ts'))
    await vi.waitFor(
      () => expect(events()).toContainEqual({ type: 'delete', relPath: 'src/a.ts' }),
      { timeout: 5000 }
    )
  })

  it('maps paths correctly when the workspace root is a symlink', async () => {
    // regression: macOS /var -> /private/var symlinks broke relPath mapping
    const { root, events } = await watchedDir((real) => {
      const linkBase = mkdtempSync(join(tmpdir(), 'argus-watchlink-'))
      const link = join(linkBase, 'workspace')
      symlinkSync(real, link)
      cleanups.push(() => rmSync(linkBase, { recursive: true, force: true }))
      return link
    })

    writeFileSync(join(root, 'linked.ts'), 'x\n')
    await vi.waitFor(
      () => expect(events()).toContainEqual({ type: 'create', relPath: 'linked.ts' }),
      { timeout: 5000 }
    )
  })

  it('filters .git internals and ignores node_modules', async () => {
    const { root, events } = await watchedDir()
    mkdirSync(join(root, '.git'))
    mkdirSync(join(root, 'node_modules'))

    writeFileSync(join(root, '.git/HEAD'), 'ref: refs/heads/main\n')
    writeFileSync(join(root, 'node_modules/dep.js'), 'x\n')
    writeFileSync(join(root, 'visible.ts'), 'x\n')

    await vi.waitFor(
      () => expect(events()).toContainEqual({ type: 'create', relPath: 'visible.ts' }),
      { timeout: 5000 }
    )
    const paths = events().map((e) => e.relPath)
    expect(paths.some((p) => p.startsWith('.git'))).toBe(false)
    // the directory's own create event may slip through coalescing; the
    // guarantee is that nothing INSIDE node_modules is watched
    expect(paths.some((p) => p.startsWith('node_modules/'))).toBe(false)
  })

  it('subscribes once per window', async () => {
    const real = realpathSync(mkdtempSync(join(tmpdir(), 'argus-watch-once-')))
    const stub = new StubBrowserWindow()
    cleanups.push(() => {
      stub.close()
      rmSync(real, { recursive: true, force: true })
    })
    await startWatching(stub as unknown as BrowserWindow, real)
    await startWatching(stub as unknown as BrowserWindow, real) // no-op

    writeFileSync(join(real, 'once.ts'), 'x\n')
    await vi.waitFor(
      () => {
        const batches = stub.webContents.sent.filter((m) => m.channel === 'watch:events')
        expect(batches.length).toBeGreaterThan(0)
        const all = batches.flatMap((m) => m.args[0] as WatchEvent[])
        expect(all.filter((e) => e.relPath === 'once.ts')).toHaveLength(1)
      },
      { timeout: 5000 }
    )
  })
})
