import { afterEach, describe, expect, it } from 'vitest'
import type { SentMessage } from '../../test/electronStub'
import { StubBrowserWindow } from '../../test/electronStub'
import { buildCrashReport, MAX_DETAIL, reportCrash } from './crashReporter'

function crashesSentTo(window: StubBrowserWindow): SentMessage[] {
  return window.webContents.sent.filter((m) => m.channel === 'app:crash')
}

describe('buildCrashReport', () => {
  const base = {
    origin: 'lsp' as const,
    title: 'Language server crashed',
    label: 'vtsls (repo)',
    summary: 'killed by signal SIGSEGV (code null)',
    detail: 'stack trace here'
  }

  it('passes fields through with the given id/at', () => {
    const r = buildCrashReport(base, 1234, 'id-1')
    expect(r).toEqual({ ...base, id: 'id-1', at: 1234 })
  })

  it('defaults a missing label to empty', () => {
    const r = buildCrashReport({ ...base, label: undefined }, 1, 'x')
    expect(r.label).toBe('')
  })

  it('trims detail and falls back when empty', () => {
    expect(buildCrashReport({ ...base, detail: '   \n  ' }, 1, 'x').detail).toBe(
      '(no output captured)'
    )
    expect(buildCrashReport({ ...base, detail: '  hello  ' }, 1, 'x').detail).toBe('hello')
  })

  it('caps oversized detail with a truncation marker', () => {
    const huge = 'x'.repeat(MAX_DETAIL + 5000)
    const r = buildCrashReport({ ...base, detail: huge }, 1, 'x')
    expect(r.detail.length).toBeLessThanOrEqual(MAX_DETAIL + '\n…(truncated)'.length)
    expect(r.detail.endsWith('…(truncated)')).toBe(true)
  })
})

describe('reportCrash', () => {
  afterEach(() => {
    // close any windows opened by a test so they don't leak into later ones
    for (const w of StubBrowserWindow.getAllWindows()) w.close()
  })

  it('broadcasts to every live window when no windowId is given', () => {
    const a = new StubBrowserWindow()
    const b = new StubBrowserWindow()
    reportCrash({ origin: 'main', title: 'Main process error', summary: 'boom', detail: 'trace' })
    expect(crashesSentTo(a)).toHaveLength(1)
    expect(crashesSentTo(b)).toHaveLength(1)
    const report = crashesSentTo(a)[0].args[0] as { title: string; summary: string }
    expect(report.title).toBe('Main process error')
    expect(report.summary).toBe('boom')
  })

  it('targets only the owning window when windowId is given', () => {
    const owner = new StubBrowserWindow()
    const other = new StubBrowserWindow()
    reportCrash({
      origin: 'lsp',
      title: 'Language server crashed',
      summary: 'died',
      detail: 'stderr',
      windowId: owner.id
    })
    expect(crashesSentTo(owner)).toHaveLength(1)
    expect(crashesSentTo(other)).toHaveLength(0)
  })

  it('does not throw when the target window is gone', () => {
    expect(() =>
      reportCrash({
        origin: 'git',
        title: 'Git command failed',
        summary: 'x',
        detail: 'y',
        windowId: 9999
      })
    ).not.toThrow()
  })
})
