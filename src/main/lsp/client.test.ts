import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { liveProcesses } from '../procRegistry'
import { LspInstance } from './client'

const FAKE_SERVER = join(__dirname, '../../../test/fakeLspServer.mjs')

describe('LspInstance initialize timeout (spec 08)', () => {
  it('rejects and kills a server that never answers the handshake', async () => {
    const instance = new LspInstance({
      name: 'hang-ls',
      cmd: process.execPath,
      args: [FAKE_SERVER],
      cwd: __dirname,
      env: { ...process.env, FAKE_LSP_HANG_INIT: '1' } as Record<string, string>,
      initializeTimeoutMs: 300,
      onDiagnostics: () => {},
      onExit: () => {}
    })

    await expect(instance.initialize()).rejects.toThrow(/timed out/)
    expect(instance.state).toBe('dead')

    // the spawned process must not linger once the handshake is abandoned
    await vi.waitFor(() => expect(liveProcesses().filter((p) => p.kind === 'lsp')).toEqual([]), {
      timeout: 5000
    })
  })

  it('initializes normally against a responsive server', async () => {
    const instance = new LspInstance({
      name: 'ok-ls',
      cmd: process.execPath,
      args: [FAKE_SERVER],
      cwd: __dirname,
      env: { ...process.env } as Record<string, string>,
      initializeTimeoutMs: 5000,
      onDiagnostics: () => {},
      onExit: () => {}
    })
    try {
      await instance.initialize()
      expect(instance.state).toBe('running')
      expect(instance.supportsPullDiagnostics()).toBe(true)
    } finally {
      instance.kill()
    }
  })
})
