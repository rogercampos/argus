import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import type { Diagnostic } from 'vscode-languageserver-protocol'
import type {
  LspCompletionItem,
  LspDiagnostic,
  LspHoverResult,
  LspLocation,
  LspSymbol
} from '../../shared/types'
import { trackedSpawn } from '../procRegistry'
import { schemaForModel } from '../schema'
import { SemgrepRunner } from '../semgrep'
import { startTask } from '../tasks'
import { LspInstance } from './client'
import { extractToolVersions, resolveShellEnv } from './env'
import { ProjectRegistry } from './projects'
import { buildServerRegistry, languageIdForPath, type ServerConfig } from './servers'

/**
 * Per-window LSP manager (spec 08): project-scoped server instances,
 * full-text document sync, request fan-out with merge, push+pull
 * diagnostics merged by source.
 */

const MAX_RESTARTS = 3

/** E2E runs disable language servers + semgrep: no installs, no spawned servers. */
const LSP_DISABLED = process.env.ARGUS_DISABLE_LSP === '1'

interface OpenDoc {
  relPath: string
  languageId: string
  text: string
  version: number
}

export class LspManager {
  private projects: ProjectRegistry
  /** `${server}:${root}` → instance or in-flight start */
  private instances = new Map<string, Promise<LspInstance | null>>()
  private restarts = new Map<string, number>()
  private installing = new Set<string>()
  private openDocs = new Map<string, OpenDoc>()
  /** path → source → diagnostics */
  private diagnostics = new Map<string, Map<string, LspDiagnostic[]>>()
  private pullTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private disposed = false

  private semgrep: SemgrepRunner

  constructor(
    private root: string,
    private window: BrowserWindow
  ) {
    this.projects = new ProjectRegistry(root)
    this.projects.onChange((projects) => this.send('lsp:projects', projects))
    this.semgrep = new SemgrepRunner(root, (relPath, diagnostics) =>
      this.acceptConverted(relPath, 'semgrep', diagnostics)
    )
  }

  /** Re-scan hooks for non-LSP diagnostics providers (semgrep). */
  noteFileSaved(relPath: string): void {
    if (LSP_DISABLED) return
    this.semgrep.scan(relPath)
  }

  dispose(): void {
    this.disposed = true
    for (const timer of this.pullTimers.values()) clearTimeout(timer)
    this.pullTimers.clear()
    for (const promise of this.instances.values()) {
      void promise.then((instance) => instance?.kill())
    }
  }

  private send(channel: string, payload: unknown): void {
    if (!this.disposed && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload)
    }
  }

  private abs(relPath: string): string {
    return relPath.startsWith('/') ? relPath : join(this.root, relPath)
  }

  private uri(relPath: string): string {
    return `file://${this.abs(relPath)}`
  }

  private relFromUri(uri: string): string {
    const path = decodeURIComponent(uri.replace(/^file:\/\//, ''))
    return path.startsWith(`${this.root}/`) ? path.slice(this.root.length + 1) : path
  }

  /** All running instances that serve this file's language. */
  private async instancesForFile(relPath: string): Promise<LspInstance[]> {
    if (this.disposed || LSP_DISABLED) return []
    const languageId = languageIdForPath(relPath)
    if (!languageId) return []
    const env = await resolveShellEnv(this.root)
    const registry = buildServerRegistry(env)
    const matching = registry.filter((c) => c.languages.includes(languageId))
    const result: LspInstance[] = []
    for (const config of matching) {
      const instance = await this.ensureInstance(config, relPath)
      if (instance) result.push(instance)
    }
    return result
  }

  private async ensureInstance(config: ServerConfig, relPath: string): Promise<LspInstance | null> {
    let project = await this.projects.projectForFile(this.abs(relPath))
    if (!project.kinds.includes(config.projectKind)) {
      // file in a project without this kind: fall back to ancestor (e.g. ruby file in a js subdir)
      project = await this.projects.ancestorWithKind(project, config.projectKind)
      if (!project.kinds.includes(config.projectKind)) return null
    }
    if (!config.perProjectInstance) {
      project = await this.projects.ancestorWithKind(project, config.projectKind)
    }
    const key = `${config.name}:${project.root}`
    if ((this.restarts.get(key) ?? 0) >= MAX_RESTARTS) return null

    const existing = this.instances.get(key)
    if (existing) {
      const instance = await existing
      if (instance && instance.state !== 'dead') return instance
      this.instances.delete(key)
    }

    const promise = this.startInstance(config, project.root, key)
    this.instances.set(key, promise)
    return promise
  }

  private async startInstance(
    config: ServerConfig,
    projectRoot: string,
    key: string
  ): Promise<LspInstance | null> {
    const dataDir = app.getPath('userData')
    const env = await resolveShellEnv(projectRoot)

    let command = await config.command(projectRoot, dataDir)
    if (!command && config.install && !this.installing.has(config.name)) {
      this.installing.add(config.name)
      const task = startTask(this.window, `Installing ${config.name} (one-time setup)`)
      try {
        const install = config.install(dataDir, env)
        await new Promise<void>((resolve) => {
          const child = trackedSpawn(
            install.cmd,
            install.args,
            { env },
            { kind: 'install', label: `install ${config.name}`, windowId: this.window.id }
          )
          child.on('exit', () => resolve())
          child.on('error', () => resolve())
        })
      } finally {
        task.finish()
        this.installing.delete(config.name)
      }
      command = await config.command(projectRoot, dataDir)
    }
    if (!command) return null
    void this.maybeAutoUpdate(config, dataDir, env)

    try {
      const instance = new LspInstance({
        name: config.name,
        cmd: command.cmd,
        args: command.args,
        cwd: projectRoot,
        env,
        windowId: this.window.id,
        initializationOptions: await config.initializationOptions?.(projectRoot),
        settings: await config.settings?.(projectRoot, { excludeGems: true }),
        onDiagnostics: (uri, diagnostics) =>
          this.acceptDiagnostics(this.relFromUri(uri), config.name, diagnostics),
        onExit: () => {
          this.restarts.set(key, (this.restarts.get(key) ?? 0) + 1)
          this.instances.delete(key)
        }
      })
      await instance.initialize()

      // project tool versions for the Projects view
      const project = this.projects.all().find((p) => p.root === projectRoot)
      if (project) project.toolVersions = extractToolVersions(env)
      this.send('lsp:projects', this.projects.all())

      // open already-open docs this instance serves
      for (const doc of this.openDocs.values()) {
        if (config.languages.includes(doc.languageId)) {
          instance.notify('textDocument/didOpen', {
            textDocument: {
              uri: this.uri(doc.relPath),
              languageId: doc.languageId,
              version: doc.version,
              text: doc.text
            }
          })
        }
      }
      return instance
    } catch {
      this.restarts.set(key, (this.restarts.get(key) ?? 0) + 1)
      return null
    }
  }

  private acceptDiagnostics(relPath: string, source: string, raw: Diagnostic[]): void {
    this.acceptConverted(
      relPath,
      source,
      raw.map((d) => ({
        startLine: d.range.start.line,
        startChar: d.range.start.character,
        endLine: d.range.end.line,
        endChar: d.range.end.character,
        severity: (d.severity ?? 1) as LspDiagnostic['severity'],
        message: typeof d.message === 'string' ? d.message : String(d.message),
        source: d.source ?? source
      }))
    )
  }

  /** Merge by source (spec 12): eslint + vtsls + semgrep coexist per file. */
  private acceptConverted(relPath: string, source: string, list: LspDiagnostic[]): void {
    const bySource = this.diagnostics.get(relPath) ?? new Map<string, LspDiagnostic[]>()
    bySource.set(source, list)
    this.diagnostics.set(relPath, bySource)
    const merged = [...bySource.values()].flat()
    merged.sort((a, b) => a.startLine - b.startLine || a.startChar - b.startChar)
    this.send('lsp:diagnostics', { path: relPath, diagnostics: merged })
  }

  /** Silent server auto-update, at most once per 24h (spec 08). */
  private async maybeAutoUpdate(
    config: ServerConfig,
    dataDir: string,
    env: Record<string, string>
  ): Promise<void> {
    if (!config.install) return
    const marker = join(dataDir, 'lsp-update-markers', config.name)
    try {
      const stat = await fs.stat(marker)
      if (Date.now() - stat.mtimeMs < 24 * 3600 * 1000) return
    } catch {
      // no marker yet — server was just installed; stamp and skip
      await fs.mkdir(dirname(marker), { recursive: true })
      await fs.writeFile(marker, new Date().toISOString())
      return
    }
    await fs.writeFile(marker, new Date().toISOString())
    const install = config.install(dataDir, env)
    trackedSpawn(
      install.cmd,
      install.args,
      { env },
      { kind: 'install', label: `update ${config.name}` }
    ).on('error', () => {})
  }

  /** Rails schema for an AR model file, or null (spec 11). */
  async railsSchema(relPath: string): Promise<import('../../shared/types').RailsSchemaInfo | null> {
    const project = await this.projects.projectForFile(this.abs(relPath))
    if (!project.isRails) return null
    const relInProject =
      project.root === this.root ? relPath : this.abs(relPath).slice(project.root.length + 1)
    return schemaForModel(project.root, relInProject)
  }

  async didOpen(relPath: string, text: string): Promise<void> {
    if (this.disposed) return
    const languageId = languageIdForPath(relPath)
    if (!languageId) return
    this.openDocs.set(relPath, { relPath, languageId, text, version: 1 })
    this.semgrep.scan(relPath)
    const instances = await this.instancesForFile(relPath)
    for (const instance of instances) {
      instance.notify('textDocument/didOpen', {
        textDocument: { uri: this.uri(relPath), languageId, version: 1, text }
      })
    }
    this.schedulePull(relPath)
  }

  async didChange(relPath: string, text: string): Promise<void> {
    if (this.disposed) return
    const doc = this.openDocs.get(relPath)
    if (!doc) return
    doc.text = text
    doc.version += 1
    const instances = await this.instancesForFile(relPath)
    for (const instance of instances) {
      instance.notify('textDocument/didChange', {
        textDocument: { uri: this.uri(relPath), version: doc.version },
        contentChanges: [{ text }]
      })
    }
    this.schedulePull(relPath)
  }

  async didClose(relPath: string): Promise<void> {
    if (!this.openDocs.delete(relPath)) return
    const instances = await this.instancesForFile(relPath)
    for (const instance of instances) {
      instance.notify('textDocument/didClose', {
        textDocument: { uri: this.uri(relPath) }
      })
    }
    this.diagnostics.delete(relPath)
    this.send('lsp:diagnostics', { path: relPath, diagnostics: [] })
  }

  /** Pull diagnostics (spec 08), debounced 500ms, for capable servers. */
  private schedulePull(relPath: string): void {
    const existing = this.pullTimers.get(relPath)
    if (existing) clearTimeout(existing)
    this.pullTimers.set(
      relPath,
      setTimeout(() => {
        void (async () => {
          const instances = await this.instancesForFile(relPath)
          for (const instance of instances) {
            if (!instance.supportsPullDiagnostics()) continue
            try {
              const report = (await instance.connection.sendRequest('textDocument/diagnostic', {
                textDocument: { uri: this.uri(relPath) }
              })) as { kind: string; items?: Diagnostic[] }
              if (report.kind === 'full' && report.items) {
                this.acceptDiagnostics(relPath, instance.name, report.items)
              }
            } catch {
              // server may not be ready yet
            }
          }
        })()
      }, 500)
    )
  }

  async hover(relPath: string, line: number, character: number): Promise<LspHoverResult | null> {
    const instances = await this.instancesForFile(relPath)
    for (const instance of instances) {
      try {
        const result = (await instance.connection.sendRequest('textDocument/hover', {
          textDocument: { uri: this.uri(relPath) },
          position: { line, character }
        })) as { contents: unknown } | null
        if (!result?.contents) continue
        const contents = result.contents
        let text = ''
        if (typeof contents === 'string') text = contents
        else if (Array.isArray(contents)) {
          text = contents
            .map((c) => (typeof c === 'string' ? c : (c as { value: string }).value))
            .join('\n\n')
        } else text = (contents as { value: string }).value
        if (text.trim()) return { contents: text }
      } catch {
        // try next server
      }
    }
    return null
  }

  async definition(
    relPath: string,
    line: number,
    character: number,
    kind: 'definition' | 'typeDefinition'
  ): Promise<LspLocation[]> {
    const instances = await this.instancesForFile(relPath)
    const all: LspLocation[] = []
    for (const instance of instances) {
      try {
        const result = (await instance.connection.sendRequest(`textDocument/${kind}`, {
          textDocument: { uri: this.uri(relPath) },
          position: { line, character }
        })) as
          | { uri: string; range: { start: { line: number; character: number } } }
          | Array<{
              uri?: string
              targetUri?: string
              range?: { start: { line: number; character: number } }
              targetRange?: { start: { line: number; character: number } }
            }>
          | null
        if (!result) continue
        const items = Array.isArray(result) ? result : [result]
        for (const item of items) {
          const uri =
            'targetUri' in item && item.targetUri ? item.targetUri : (item as { uri: string }).uri
          const range =
            'targetRange' in item && item.targetRange
              ? item.targetRange
              : (item as { range: { start: { line: number; character: number } } }).range
          if (!uri || !range) continue
          all.push({
            path: this.relFromUri(uri),
            line: range.start.line,
            character: range.start.character
          })
        }
      } catch {
        // try next
      }
    }
    // dedup
    const seen = new Set<string>()
    return all.filter((l) => {
      const key = `${l.path}:${l.line}:${l.character}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  async completion(relPath: string, line: number, character: number): Promise<LspCompletionItem[]> {
    const instances = await this.instancesForFile(relPath)
    const all: LspCompletionItem[] = []
    for (const instance of instances) {
      try {
        const result = (await instance.connection.sendRequest('textDocument/completion', {
          textDocument: { uri: this.uri(relPath) },
          position: { line, character }
        })) as
          | { items: Array<{ label: string; kind?: number; detail?: string; insertText?: string }> }
          | Array<{ label: string; kind?: number; detail?: string; insertText?: string }>
          | null
        if (!result) continue
        const items = Array.isArray(result) ? result : (result.items ?? [])
        for (const item of items.slice(0, 200)) {
          all.push({
            label: item.label,
            kind: item.kind,
            detail: item.detail,
            insertText: item.insertText ?? item.label
          })
        }
      } catch {
        // try next
      }
    }
    return all
  }

  async workspaceSymbols(query: string): Promise<LspSymbol[]> {
    // fan out to every running instance
    const all: LspSymbol[] = []
    for (const promise of this.instances.values()) {
      const instance = await promise
      if (instance?.state !== 'running') continue
      try {
        const result = (await instance.connection.sendRequest('workspace/symbol', {
          query
        })) as Array<{
          name: string
          kind: number
          containerName?: string
          location: { uri: string; range: { start: { line: number; character: number } } }
        }> | null
        for (const symbol of result ?? []) {
          const path = this.relFromUri(symbol.location.uri)
          // exclude stub files (spec 05)
          if (path.endsWith('.rbi') || path.endsWith('.rbs')) continue
          all.push({
            name: symbol.name,
            kind: symbol.kind,
            containerName: symbol.containerName,
            location: {
              path,
              line: symbol.location.range.start.line,
              character: symbol.location.range.start.character
            }
          })
        }
      } catch {
        // skip
      }
    }
    return all.slice(0, 500)
  }
}

const managers = new Map<number, LspManager>()

export function lspManagerFor(window: BrowserWindow, root: string): LspManager | null {
  if (window.isDestroyed()) return null // late IPC must not resurrect a manager
  let manager = managers.get(window.id)
  if (!manager) {
    manager = new LspManager(root, window)
    managers.set(window.id, manager)
    window.on('closed', () => {
      managers.get(window.id)?.dispose()
      managers.delete(window.id)
    })
  }
  return manager
}
