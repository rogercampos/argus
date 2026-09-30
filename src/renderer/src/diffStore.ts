import { create } from 'zustand'
import { formatDiffTarget } from '../../shared/diffTarget'
import type { DiffFileEntry, DiffSource, DiffSummary } from '../../shared/types'
import type { DiffLayout } from './diffEditor'

/**
 * State for a diff review window: what's being compared, the loaded file
 * list, and per-file review state (collapsed / viewed). Viewed marks are
 * kept per target, so re-running or refreshing the same comparison keeps them.
 */

const LAYOUT_KEY = 'argus.diff.layout'

/** Above this many changed lines a file starts collapsed (lockfiles, generated code). */
export const LARGE_DIFF_LINES = 1500
const GENERATED =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Gemfile\.lock|Cargo\.lock|poetry\.lock|composer\.lock)$|\.min\.(js|css)$/

export function startsCollapsed(file: DiffFileEntry): boolean {
  if (file.binary) return false
  const lines = (file.additions ?? 0) + (file.deletions ?? 0)
  return lines > LARGE_DIFF_LINES || GENERATED.test(file.path)
}

function readLayout(): DiffLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'unified' ? 'unified' : 'split'
  } catch {
    return 'split'
  }
}

interface DiffState {
  repoPath: string
  source: DiffSource
  status: 'loading' | 'ready' | 'error'
  summary: DiffSummary | null
  error: string | null
  /** bumps on every successful load, so file views re-read their contents */
  generation: number
  layout: DiffLayout
  collapsed: Set<string>
  viewed: Set<string>
  /** the file currently at the top of the scroll area */
  activePath: string | null
  filter: string

  load(source: DiffSource): Promise<void>
  refresh(): Promise<void>
  setLayout(layout: DiffLayout): void
  setCollapsed(path: string, collapsed: boolean): void
  toggleViewed(path: string): void
  setActivePath(path: string | null): void
  setFilter(filter: string): void
}

const viewedByTarget = new Map<string, Set<string>>()
let loadSeq = 0

// optional: tests install window.api after this module loads
const init = window.api?.windowInit.diff

export const useDiffStore = create<DiffState>((set, get) => ({
  repoPath: init?.repoPath ?? '',
  source: init?.source ?? { kind: 'uncommitted' },
  status: 'loading',
  summary: null,
  error: null,
  generation: 0,
  layout: readLayout(),
  collapsed: new Set(),
  viewed: new Set(),
  activePath: null,
  filter: '',

  load: async (source) => {
    const seq = ++loadSeq
    const sameTarget =
      get().summary !== null && formatDiffTarget(source) === formatDiffTarget(get().source)
    set({ source, status: 'loading', error: null })
    const result = await window.api.loadDiff(source)
    if (seq !== loadSeq) return // a newer load superseded this one

    if (!result.ok) {
      set({ status: 'error', error: result.error, summary: null })
      return
    }
    const key = formatDiffTarget(source)
    const viewed = viewedByTarget.get(key) ?? new Set<string>()
    viewedByTarget.set(key, viewed)
    const known = new Set(result.summary.files.map((f) => f.path))
    for (const path of viewed) if (!known.has(path)) viewed.delete(path)

    // keep the user's collapse choices across a refresh of the same target
    const collapsed = sameTarget
      ? new Set([...get().collapsed].filter((p) => known.has(p)))
      : new Set(result.summary.files.filter(startsCollapsed).map((f) => f.path))
    for (const path of viewed) collapsed.add(path)

    set((s) => ({
      status: 'ready',
      summary: result.summary,
      generation: s.generation + 1,
      collapsed,
      viewed: new Set(viewed),
      activePath: sameTarget ? s.activePath : (result.summary.files[0]?.path ?? null)
    }))
  },

  refresh: () => get().load(get().source),

  setLayout: (layout) => {
    try {
      localStorage.setItem(LAYOUT_KEY, layout)
    } catch {
      // preference just won't stick
    }
    set({ layout })
  },

  setCollapsed: (path, collapsed) =>
    set((s) => {
      const next = new Set(s.collapsed)
      if (collapsed) next.add(path)
      else next.delete(path)
      return { collapsed: next }
    }),

  toggleViewed: (path) =>
    set((s) => {
      const viewed = new Set(s.viewed)
      const collapsed = new Set(s.collapsed)
      // marking viewed folds the file away; unmarking brings it back
      if (viewed.has(path)) {
        viewed.delete(path)
        collapsed.delete(path)
      } else {
        viewed.add(path)
        collapsed.add(path)
      }
      viewedByTarget.set(formatDiffTarget(s.source), viewed)
      return { viewed, collapsed }
    }),

  setActivePath: (activePath) => set({ activePath }),
  setFilter: (filter) => set({ filter })
}))

/** Files matching the sidebar filter (case-insensitive substring of the path). */
export function filteredFiles(files: DiffFileEntry[], filter: string): DiffFileEntry[] {
  const needle = filter.trim().toLowerCase()
  if (!needle) return files
  return files.filter(
    (f) => f.path.toLowerCase().includes(needle) || f.oldPath?.toLowerCase().includes(needle)
  )
}
