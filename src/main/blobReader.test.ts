import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BlobReader } from './blobReader'

describe('BlobReader (one git cat-file --batch process)', () => {
  let root: string

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'argus-blobs-')))
    const git = (...args: string[]): void => {
      execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
    }
    git('init', '-q')
    writeFileSync(join(root, 'a.txt'), 'alpha\n')
    writeFileSync(join(root, 'b.txt'), 'bravo\nwith\nlines\n')
    writeFileSync(join(root, 'bin.dat'), Buffer.from([0, 10, 255, 10, 0]))
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(5000))
    writeFileSync(join(root, 'empty.txt'), '')
    git('add', '.')
    git('-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init')
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('answers concurrent reads in order, with exact bytes', async () => {
    const reader = new BlobReader(root, 1000)
    try {
      const [a, b, bin, empty] = await Promise.all([
        reader.read('HEAD:a.txt'),
        reader.read('HEAD:b.txt'),
        reader.read('HEAD:bin.dat'),
        reader.read('HEAD:empty.txt')
      ])
      expect(a).toEqual({ kind: 'blob', data: Buffer.from('alpha\n') })
      expect(b).toEqual({ kind: 'blob', data: Buffer.from('bravo\nwith\nlines\n') })
      // newlines inside content don't confuse the framing
      expect(bin).toEqual({ kind: 'blob', data: Buffer.from([0, 10, 255, 10, 0]) })
      expect(empty).toEqual({ kind: 'blob', data: Buffer.alloc(0) })
    } finally {
      reader.dispose()
    }
  })

  it('reports missing objects, non-blobs and oversized blobs without losing sync', async () => {
    const reader = new BlobReader(root, 1000)
    try {
      const results = await Promise.all([
        reader.read('HEAD:nope.txt'),
        reader.read('HEAD:big.txt'),
        reader.read('HEAD^{tree}'),
        reader.read('HEAD:a.txt')
      ])
      expect(results).toEqual([
        { kind: 'missing' },
        { kind: 'too-large' },
        { kind: 'missing' },
        { kind: 'blob', data: Buffer.from('alpha\n') }
      ])
    } finally {
      reader.dispose()
    }
  })

  it('reads the index with :path', async () => {
    const reader = new BlobReader(root, 1000)
    try {
      expect(await reader.read(':a.txt')).toEqual({ kind: 'blob', data: Buffer.from('alpha\n') })
    } finally {
      reader.dispose()
    }
  })

  it('rejects names with newlines (they would break the line protocol)', async () => {
    const reader = new BlobReader(root, 1000)
    await expect(reader.read('HEAD:a\nb')).rejects.toThrow('newline')
    reader.dispose()
  })

  it('rejects pending reads on dispose, and respawns on the next read', async () => {
    const reader = new BlobReader(root, 1000)
    const pending = reader.read('HEAD:a.txt')
    reader.dispose()
    await expect(pending).rejects.toThrow('blob reader closed')
    expect(await reader.read('HEAD:b.txt')).toEqual({
      kind: 'blob',
      data: Buffer.from('bravo\nwith\nlines\n')
    })
    reader.dispose()
  })

  it('fails reads cleanly when git can’t run in the directory', async () => {
    const reader = new BlobReader(join(root, 'does-not-exist'), 1000)
    await expect(reader.read('HEAD:a.txt')).rejects.toThrow()
    reader.dispose()
  })
})
