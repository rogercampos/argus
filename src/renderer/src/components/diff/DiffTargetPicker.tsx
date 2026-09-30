import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDiffTarget, parseDiffTarget } from '../../../../shared/diffTarget'
import type { DiffCommitOption, DiffPrOption, DiffSource } from '../../../../shared/types'
import { useDiffStore } from '../../diffStore'
import { TextInput } from '../ui/TextInput'

/**
 * The comparison picker: one field that takes anything parseDiffTarget
 * understands (HEAD~2, main...feature, #42, a PR URL, "staged"…), with a
 * dropdown of presets, open pull requests and recent commits to click.
 */

interface Option {
  key: string
  source: DiffSource
  primary: string
  secondary: string
  /** lowercased text the filter matches against */
  haystack: string
}

function describeSource(source: DiffSource): string {
  switch (source.kind) {
    case 'uncommitted':
      return 'Uncommitted changes'
    case 'staged':
      return 'Staged changes'
    case 'commit':
      return `Commit ${source.ref}`
    case 'range':
      return `Compare ${formatDiffTarget(source)}`
    case 'pr':
      return `Pull request ${formatDiffTarget(source)}`
  }
}

const PRESETS: Option[] = [
  {
    key: 'working',
    source: { kind: 'uncommitted' },
    primary: 'Uncommitted changes',
    secondary: 'staged, unstaged and untracked',
    haystack: 'uncommitted changes working'
  },
  {
    key: 'staged',
    source: { kind: 'staged' },
    primary: 'Staged changes',
    secondary: 'what the next commit will contain',
    haystack: 'staged changes index'
  }
]

function relativeDate(unixSeconds: number): string {
  const days = Math.floor((Date.now() / 1000 - unixSeconds) / 86400)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(unixSeconds * 1000).toLocaleDateString()
}

export function DiffTargetPicker(): React.JSX.Element {
  const source = useDiffStore((s) => s.source)
  const load = useDiffStore((s) => s.load)

  const [text, setText] = useState(() => formatDiffTarget(source))
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [commits, setCommits] = useState<DiffCommitOption[] | null>(null)
  const [prs, setPrs] = useState<DiffPrOption[] | null>(null)
  const [prError, setPrError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // the field mirrors the loaded comparison whenever it changes elsewhere
  useEffect(() => setText(formatDiffTarget(source)), [source])

  // suggestions load on first open (gh can take a second; never block on it)
  useEffect(() => {
    if (!open) return
    if (commits === null) void window.api.diffRecentCommits(40).then(setCommits)
    if (prs === null && prError === null) {
      void window.api.diffOpenPullRequests().then((result) => {
        if (result.ok) setPrs(result.prs)
        else setPrError(result.error)
      })
    }
  }, [open, commits, prs, prError])

  const current = formatDiffTarget(source)
  const needle = text === current ? '' : text.trim().toLowerCase()

  const { options, rawIndex } = useMemo(() => {
    const suggestions: Option[] = [
      ...PRESETS,
      ...(prs ?? []).map((pr) => ({
        key: `pr:${pr.number}`,
        source: { kind: 'pr', ref: String(pr.number) } as DiffSource,
        primary: `#${pr.number} ${pr.title}`,
        secondary: `${pr.author} · ${pr.headRefName}`,
        haystack: `#${pr.number} ${pr.title} ${pr.author} ${pr.headRefName}`.toLowerCase()
      })),
      ...(commits ?? []).map((c) => ({
        key: `commit:${c.sha}`,
        source: { kind: 'commit', ref: c.sha.slice(0, 12) } as DiffSource,
        primary: c.subject,
        secondary: `${c.sha.slice(0, 7)} · ${c.author} · ${relativeDate(c.date)}`,
        haystack: `${c.sha} ${c.subject} ${c.author}`.toLowerCase()
      }))
    ]
    const matches = needle ? suggestions.filter((o) => o.haystack.includes(needle)) : suggestions
    if (!needle) return { options: matches, rawIndex: -1 }
    // what was typed, taken literally, is always an option
    const parsed = parseDiffTarget(text)
    const raw: Option = {
      key: 'raw',
      source: parsed,
      primary: describeSource(parsed),
      secondary: 'press ↵',
      haystack: ''
    }
    return { options: [raw, ...matches], rawIndex: 0 }
  }, [prs, commits, needle, text])

  // prefer the first real match (typing "login" means the commit, not a ref
  // called "login"); fall back to the literal text when nothing matches
  useEffect(() => {
    setHighlight(rawIndex === 0 && options.length > 1 ? 1 : 0)
  }, [options, rawIndex])

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  const choose = (option: Option | undefined): void => {
    const next = option?.source ?? parseDiffTarget(text)
    setOpen(false)
    inputRef.current?.blur()
    void load(next)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlight((h) => Math.min(options.length - 1, h + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(open ? options[highlight] : undefined)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setText(current)
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  return (
    <div className="no-drag relative w-full max-w-130">
      <TextInput
        ref={inputRef}
        value={text}
        aria-label="Comparison"
        placeholder="working, staged, HEAD~1, main...feature, #123"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
        }}
        onFocus={(e) => {
          e.target.select()
          setOpen(true)
        }}
        onBlur={() => {
          // let a click on an option land first
          setTimeout(() => setOpen(false), 120)
        }}
        onKeyDown={onKeyDown}
        className="w-full py-1 text-chrome"
      />
      {open && (
        <div
          ref={listRef}
          role="listbox"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-[60vh] overflow-y-auto rounded-md border border-edge bg-secondary py-1 shadow-popover"
        >
          {options.map((option, index) => (
            <div key={option.key}>
              {!needle && index === PRESETS.length && prs && prs.length > 0 && (
                <Heading>Pull requests</Heading>
              )}
              {!needle && index === PRESETS.length + (prs?.length ?? 0) && commits && (
                <Heading>Recent commits</Heading>
              )}
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                data-index={index}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(option)}
                className={`flex w-full cursor-pointer items-baseline gap-3 px-3 py-1.5 text-left ${
                  index === highlight ? 'bg-selection' : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-chrome text-fg">
                  {option.primary}
                </span>
                <span className="shrink-0 truncate font-mono text-label text-fg-dim">
                  {option.secondary}
                </span>
              </button>
            </div>
          ))}
          {!needle && prError && (
            <div className="border-t border-edge px-3 pt-2 pb-1 text-label text-fg-dim">
              Pull requests unavailable: {prError}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Heading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="border-t border-edge px-3 pt-2 pb-1 text-label font-medium tracking-wide text-fg-dim uppercase">
      {children}
    </div>
  )
}
