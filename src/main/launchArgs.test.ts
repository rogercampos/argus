import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseLaunchArgs } from './launchArgs'

describe('parseLaunchArgs', () => {
  let dir: string

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'argus-launch-')))
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('ignores Electron’s own arguments', () => {
    expect(parseLaunchArgs(['/Applications/Argus', '.'], '/cwd')).toEqual({ kind: 'none' })
  })

  it('opens an existing absolute folder as a workspace', () => {
    expect(parseLaunchArgs(['argus', dir], '/cwd')).toEqual({ kind: 'workspace', dir })
    expect(parseLaunchArgs(['argus', join(dir, 'missing')], '/cwd')).toEqual({ kind: 'none' })
  })

  it('opens a diff of the working directory with a bare --diff', () => {
    expect(parseLaunchArgs(['argus', '--diff'], '/cwd')).toEqual({
      kind: 'diff',
      dir: '/cwd',
      target: ''
    })
  })

  it('passes the diff target and an explicit folder through', () => {
    expect(parseLaunchArgs(['argus', '--diff=main...HEAD', dir], '/cwd')).toEqual({
      kind: 'diff',
      dir,
      target: 'main...HEAD'
    })
  })

  it('never mistakes the app’s own directory (dev launches) for a folder', () => {
    expect(parseLaunchArgs(['electron', dir, '--diff=HEAD'], '/cwd', dir)).toEqual({
      kind: 'diff',
      dir: '/cwd',
      target: 'HEAD'
    })
    expect(parseLaunchArgs(['electron', dir], '/cwd', dir)).toEqual({ kind: 'none' })
  })
})
