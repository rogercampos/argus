import type { ChildProcess } from 'node:child_process'
import { trackedSpawn } from './procRegistry'

/**
 * Reads git objects through one long-lived `git cat-file --batch` process
 * instead of spawning git per file: a diff window reading both sides of 50
 * files costs one process, not 200. Requests are answered strictly in order,
 * so a FIFO of pending reads pairs each response with its request.
 *
 * Protocol: write `<object>\n`; git answers `<oid> <type> <size>\n<content>\n`
 * or `<object> missing\n`. Oversized contents are skipped as they stream past,
 * never buffered. The process exits after a quiet spell and respawns on demand.
 */

export type BlobResult =
  | { kind: 'blob'; data: Buffer }
  | { kind: 'missing' }
  | { kind: 'too-large' }

interface Pending {
  resolve: (result: BlobResult) => void
  reject: (error: Error) => void
}

interface InFlight {
  pending: Pending
  /** content bytes plus the trailing newline still to come */
  remaining: number
  /** null: the content is being skipped (too large, or not a blob) */
  chunks: Buffer[] | null
  result: BlobResult | null
}

const IDLE_MS = 30_000

export class BlobReader {
  private child: ChildProcess | null = null
  private queue: Pending[] = []
  private current: InFlight | null = null
  private buffer: Buffer = Buffer.alloc(0)
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private repo: string,
    private maxSize: number,
    private windowId?: number
  ) {}

  /** `spec` is anything cat-file accepts: `<sha>:<path>`, `:<path>` (index)… */
  read(spec: string): Promise<BlobResult> {
    if (spec.includes('\n')) return Promise.reject(new Error('object name contains a newline'))
    const child = this.ensureChild()
    if (this.idleTimer) clearTimeout(this.idleTimer)
    const result = new Promise<BlobResult>((resolve, reject) => {
      this.queue.push({ resolve, reject })
      child.stdin?.write(`${spec}\n`)
    })
    return result.finally(() => this.scheduleIdle())
  }

  dispose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    const child = this.child
    this.child = null
    this.fail(new Error('blob reader closed'))
    child?.stdin?.end()
    child?.kill()
  }

  private ensureChild(): ChildProcess {
    if (this.child) return this.child
    const child = trackedSpawn(
      'git',
      ['--no-optional-locks', '-C', this.repo, 'cat-file', '--batch'],
      { stdio: ['pipe', 'pipe', 'ignore'] },
      {
        kind: 'git',
        label: 'git cat-file --batch',
        windowId: this.windowId,
        selfReportsErrors: true
      }
    )
    child.stdout?.on('data', (chunk: Buffer) => this.onData(chunk))
    child.on('error', (error) => this.onExit(child, error))
    child.on('exit', (code) => this.onExit(child, new Error(`git cat-file exited (${code})`)))
    this.child = child
    return child
  }

  private onExit(child: ChildProcess, error: Error): void {
    if (this.child !== child) return // an old process we already replaced
    this.child = null
    this.fail(error)
  }

  private fail(error: Error): void {
    const pending = [...(this.current ? [this.current.pending] : []), ...this.queue]
    this.current = null
    this.queue = []
    this.buffer = Buffer.alloc(0)
    for (const p of pending) p.reject(error)
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    for (;;) {
      if (this.current) {
        const take = Math.min(this.current.remaining, this.buffer.length)
        if (take === 0) return
        this.current.chunks?.push(this.buffer.subarray(0, take))
        this.buffer = this.buffer.subarray(take)
        this.current.remaining -= take
        if (this.current.remaining > 0) return
        const { pending, chunks, result } = this.current
        this.current = null
        // drop the trailing newline that follows every object's content
        pending.resolve(
          result ?? { kind: 'blob', data: Buffer.concat(chunks ?? []).subarray(0, -1) }
        )
        continue
      }

      const newline = this.buffer.indexOf(10)
      if (newline === -1) return
      const header = this.buffer.subarray(0, newline).toString('utf8')
      this.buffer = this.buffer.subarray(newline + 1)
      const pending = this.queue.shift()
      if (!pending) continue // nothing asked for this; shouldn't happen

      const parts = header.split(' ')
      const size = Number(parts[2])
      if (parts.length !== 3 || !Number.isFinite(size)) {
        pending.resolve({ kind: 'missing' }) // "<name> missing" / "ambiguous"
        continue
      }
      const skipped: BlobResult | null =
        parts[1] !== 'blob'
          ? { kind: 'missing' }
          : size > this.maxSize
            ? { kind: 'too-large' }
            : null
      this.current = {
        pending,
        remaining: size + 1,
        chunks: skipped ? null : [],
        result: skipped
      }
    }
  }

  /** Exit the process once nothing has been asked for a while. */
  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      if (this.queue.length === 0 && !this.current) this.dispose()
    }, IDLE_MS)
    this.idleTimer.unref?.()
  }
}
