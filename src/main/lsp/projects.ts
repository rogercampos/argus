import { promises as fs } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import type { ProjectInfo } from '../../shared/types'

/** True when `dir` is `root` itself or a descendant — a path-segment-aware
 * check, so a sibling like `/foo/bar-baz` is NOT considered inside `/foo/bar`. */
function isWithin(root: string, dir: string): boolean {
  return dir === root || dir.startsWith(root + sep)
}

/**
 * Project detection (spec 01/08): walk UP from an opened file toward the
 * workspace root; the deepest marker match is the file's project root.
 * Cached per workspace.
 */

const MARKERS: Array<{ file: string; kind: ProjectInfo['kinds'][number] }> = [
  { file: 'Gemfile', kind: 'ruby' },
  { file: 'package.json', kind: 'javascript' },
  { file: 'Cargo.toml', kind: 'rust' },
  { file: 'go.mod', kind: 'go' },
  { file: 'pyproject.toml', kind: 'python' },
  { file: 'setup.py', kind: 'python' },
  { file: 'mix.exs', kind: 'elixir' },
  { file: 'pom.xml', kind: 'java' },
  { file: 'build.gradle', kind: 'java' },
  { file: 'Package.swift', kind: 'swift' }
]

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

export class ProjectRegistry {
  /** project root (abs) → info */
  private projects = new Map<string, ProjectInfo>()
  private listeners = new Set<(projects: ProjectInfo[]) => void>()

  constructor(private workspaceRoot: string) {}

  onChange(listener: (projects: ProjectInfo[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  all(): ProjectInfo[] {
    return [...this.projects.values()]
  }

  /**
   * Find the project for a file (abs path), detecting lazily. Returns the
   * DEEPEST directory at or above the file containing any marker. A file
   * with no markers up to the workspace root belongs to the root project.
   */
  async projectForFile(absFilePath: string): Promise<ProjectInfo> {
    let dir = dirname(absFilePath)
    // ensure we stay inside the workspace
    if (!isWithin(this.workspaceRoot, dir)) dir = this.workspaceRoot

    let found: string | null = null
    let probe = dir
    while (true) {
      const cached = this.projects.get(probe)
      if (cached) return cached
      for (const marker of MARKERS) {
        if (await exists(join(probe, marker.file))) {
          found = probe
          break
        }
      }
      if (found) break
      if (probe === this.workspaceRoot) break
      const parent = dirname(probe)
      if (parent === probe) break
      probe = parent
    }

    const root = found ?? this.workspaceRoot
    const existing = this.projects.get(root)
    if (existing) return existing

    const kinds: ProjectInfo['kinds'] = []
    for (const marker of MARKERS) {
      if ((await exists(join(root, marker.file))) && !kinds.includes(marker.kind)) {
        kinds.push(marker.kind)
      }
    }
    const isRails = kinds.includes('ruby') && (await exists(join(root, 'config/environment.rb')))

    const info: ProjectInfo = {
      root,
      relRoot: root === this.workspaceRoot ? '.' : root.slice(this.workspaceRoot.length + 1),
      kinds,
      isRails,
      toolVersions: {}
    }
    this.projects.set(root, info)
    for (const l of this.listeners) l(this.all())
    return info
  }

  /**
   * The nearest ANCESTOR project (or self) of `info` that has `kind` —
   * implements "don't start another server on a subfolder when a parent
   * already has one" (spec 08) for single-instance servers.
   */
  async ancestorWithKind(info: ProjectInfo, kind: string): Promise<ProjectInfo> {
    let best = info
    let probe = dirname(info.root)
    while (isWithin(this.workspaceRoot, probe) && probe !== dirname(this.workspaceRoot)) {
      const candidate = this.projects.get(probe)
      if (candidate?.kinds.includes(kind as ProjectInfo['kinds'][number])) best = candidate
      if (probe === this.workspaceRoot) break
      probe = dirname(probe)
    }
    // also check the workspace root itself even if not yet detected
    if (best === info && info.root !== this.workspaceRoot) {
      const rootMarker = kind === 'ruby' ? 'Gemfile' : kind === 'javascript' ? 'package.json' : null
      if (rootMarker && (await exists(join(this.workspaceRoot, rootMarker)))) {
        return this.projectForFile(join(this.workspaceRoot, rootMarker))
      }
    }
    return best
  }
}
