import { promises as fs, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AUTOSAVE_DELAY_MS, DocumentManager } from './documents'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('DocumentManager (spec 06)', () => {
  let dir: string
  let manager: DocumentManager

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'argus-docs-test-'))
    manager = new DocumentManager(
      async (path) => {
        try {
          return await fs.readFile(join(dir, path), 'utf8')
        } catch {
          return null
        }
      },
      async (path, content) => {
        await fs.writeFile(join(dir, path), content, 'utf8')
        return true
      }
    )
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('opens a document with its content', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello\n')
    const doc = await manager.open('a.txt', [])
    expect(doc?.state.doc.toString()).toBe('hello\n')
    expect(doc?.dirty).toBe(false)
  })

  it('returns the same document on re-open', async () => {
    const doc1 = await manager.open('a.txt', [])
    const doc2 = await manager.open('a.txt', [])
    expect(doc1).toBe(doc2)
  })

  it('returns null for unreadable files', async () => {
    expect(await manager.open('missing.txt', [])).toBeNull()
  })

  it('autosaves 700ms after the last edit and clears dirty', async () => {
    const doc = await manager.open('a.txt', [])
    if (!doc) throw new Error('doc missing')

    const dirtyEvents: boolean[] = []
    manager.onDirtyChange((path, dirty) => {
      if (path === 'a.txt') dirtyEvents.push(dirty)
    })

    const newState = doc.state.update({
      changes: { from: 0, to: doc.state.doc.length, insert: 'edited\n' }
    }).state
    manager.noteViewUpdate('a.txt', newState, true)
    expect(manager.isDirty('a.txt')).toBe(true)

    // not yet saved before the delay
    await sleep(AUTOSAVE_DELAY_MS / 2)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('hello\n')

    await sleep(AUTOSAVE_DELAY_MS)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('edited\n')
    expect(manager.isDirty('a.txt')).toBe(false)
    expect(dirtyEvents).toEqual([true, false])
  })

  it('rapid edits reset the autosave timer', async () => {
    const doc = await manager.open('a.txt', [])
    if (!doc) throw new Error('doc missing')

    let state = doc.state
    for (let i = 0; i < 3; i++) {
      state = state.update({ changes: { from: 0, insert: 'x' } }).state
      manager.noteViewUpdate('a.txt', state, true)
      await sleep(AUTOSAVE_DELAY_MS / 2)
      // still dirty: each edit pushed the save further out
      expect(manager.isDirty('a.txt')).toBe(true)
    }
    await sleep(AUTOSAVE_DELAY_MS + 100)
    expect(manager.isDirty('a.txt')).toBe(false)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('xxxedited\n')
  })

  it('external changes always win, preserving (clamped) cursor', async () => {
    writeFileSync(join(dir, 'b.txt'), 'line1\nline2\nline3\n')
    const doc = await manager.open('b.txt', [])
    if (!doc) throw new Error('doc missing')

    // dirty local edit + cursor near the end
    const edited = doc.state.update({
      changes: { from: 0, insert: 'LOCAL ' },
      selection: { anchor: 20 }
    }).state
    manager.noteViewUpdate('b.txt', edited, true)

    // external write with shorter content
    writeFileSync(join(dir, 'b.txt'), 'short\n')
    const changed = await manager.reloadFromDisk('b.txt', null)
    expect(changed).toBe(true)

    const after = manager.get('b.txt')
    if (!after) throw new Error('doc missing')
    expect(after.state.doc.toString()).toBe('short\n')
    expect(after.dirty).toBe(false)
    expect(after.state.selection.main.head).toBeLessThanOrEqual(6)
  })

  it('skips reload when content matches what we last saved', async () => {
    writeFileSync(join(dir, 'c.txt'), 'same\n')
    await manager.open('c.txt', [])
    expect(await manager.reloadFromDisk('c.txt', null)).toBe(false)
  })

  it('close flushes pending saves', async () => {
    writeFileSync(join(dir, 'd.txt'), 'orig\n')
    const doc = await manager.open('d.txt', [])
    if (!doc) throw new Error('doc missing')
    const state = doc.state.update({ changes: { from: 0, insert: 'flush ' } }).state
    manager.noteViewUpdate('d.txt', state, true)
    await manager.close('d.txt')
    expect(readFileSync(join(dir, 'd.txt'), 'utf8')).toBe('flush orig\n')
    expect(manager.get('d.txt')).toBeUndefined()
  })
})
