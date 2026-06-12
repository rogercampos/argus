import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { extractToolVersions, resolveShellEnv } from './env'

describe('shell env resolution (spec 08)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'argus-env-'))

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('resolves a real login-shell environment with a PATH', async () => {
    const env = await resolveShellEnv(dir)
    expect(env.PATH).toBeTruthy()
    expect(env.PATH).toContain('/')
  }, 20_000)

  it('caches per directory (no second shell spawn)', async () => {
    const { activitySummary } = await import('../procRegistry')
    const runsBefore = activitySummary().find((a) => a.kind === 'shell-env')?.totalCount ?? 0
    await resolveShellEnv(dir) // already resolved by the previous test
    await resolveShellEnv(dir)
    const runsAfter = activitySummary().find((a) => a.kind === 'shell-env')?.totalCount ?? 0
    expect(runsAfter).toBe(runsBefore)
  })
})

describe('extractToolVersions', () => {
  it('prefers mise variables and falls back to rbenv/node', () => {
    expect(extractToolVersions({ MISE_RUBY_VERSION: '3.3.0', RBENV_VERSION: '3.2.0' })).toEqual({
      ruby: '3.3.0'
    })
    expect(extractToolVersions({ RBENV_VERSION: '3.2.0', NODE_VERSION: '22.1.0' })).toEqual({
      ruby: '3.2.0',
      node: '22.1.0'
    })
    expect(extractToolVersions({})).toEqual({})
  })
})
