import type { ChildProcess } from 'node:child_process'
import { basename } from 'node:path'
import type { Diagnostic } from 'vscode-languageserver-protocol'
import {
  createProtocolConnection,
  type ProtocolConnection,
  StreamMessageReader,
  StreamMessageWriter
} from 'vscode-languageserver-protocol/node'
import { reportCrash } from '../crashReporter'
import { trackedSpawn } from '../procRegistry'

/**
 * One running language server instance: process + jsonrpc connection +
 * lifecycle (spec 08).
 */

/** Keep the last slice of a server's stderr so a crash can be surfaced. */
const MAX_STDERR = 16 * 1024

/** A server that never answers `initialize` must not leave the request — and
 * every request awaiting the instance — pending forever (spec 08). */
const DEFAULT_INITIALIZE_TIMEOUT_MS = 15_000

export interface LspInstanceOptions {
  name: string
  cmd: string
  args: string[]
  cwd: string
  env: Record<string, string>
  windowId?: number
  initializationOptions?: unknown
  settings?: unknown
  /** override the initialize handshake timeout (tests use a short one) */
  initializeTimeoutMs?: number
  onDiagnostics: (uri: string, diagnostics: Diagnostic[]) => void
  onExit: () => void
}

/** Reject if `promise` has not settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export class LspInstance {
  private child: ChildProcess
  connection: ProtocolConnection
  capabilities: Record<string, unknown> = {}
  state: 'starting' | 'running' | 'dead' = 'starting'
  readonly name: string
  readonly root: string
  /** rolling tail of stderr, surfaced if the server crashes */
  private stderrTail = ''
  /** set when we deliberately kill the server, so its exit isn't reported as a crash */
  private killed = false

  constructor(private options: LspInstanceOptions) {
    this.name = options.name
    this.root = options.cwd
    this.child = trackedSpawn(
      options.cmd,
      options.args,
      { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] },
      {
        kind: 'lsp',
        label: `${options.name} (${basename(options.cwd)})`,
        windowId: options.windowId
      }
    )
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-MAX_STDERR)
    })
    this.child.on('exit', (code, signal) => {
      this.state = 'dead'
      // dispose rejects in-flight sendRequest promises; without it a crash
      // mid-request leaves callers awaiting forever
      try {
        this.connection.dispose()
      } catch {
        // already disposed
      }
      // An exit we didn't ask for is a crash: surface its stderr (spec: crashes).
      if (!this.killed) {
        reportCrash({
          origin: 'lsp',
          title: 'Language server crashed',
          label: `${this.name} (${basename(this.root)})`,
          summary: signal
            ? `killed by signal ${signal} (code ${code ?? 'null'})`
            : `exited unexpectedly with code ${code ?? 'null'}`,
          detail: this.stderrTail,
          windowId: this.options.windowId
        })
      }
      options.onExit()
    })

    if (!this.child.stdout || !this.child.stdin) {
      throw new Error(`failed to spawn ${options.name}`)
    }
    this.connection = createProtocolConnection(
      new StreamMessageReader(this.child.stdout),
      new StreamMessageWriter(this.child.stdin)
    )

    this.connection.onNotification(
      'textDocument/publishDiagnostics',
      (params: { uri: string; diagnostics: Diagnostic[] }) => {
        options.onDiagnostics(params.uri, params.diagnostics)
      }
    )
    // eslint server asks permission to execute
    this.connection.onRequest('eslint/confirmESLintExecution', () => 4)
    this.connection.onRequest('workspace/configuration', (params: { items: unknown[] }) =>
      params.items.map(() => this.options.settings ?? {})
    )
    this.connection.onRequest('client/registerCapability', () => null)
    this.connection.onRequest('window/workDoneProgress/create', () => null)
    this.connection.listen()
  }

  async initialize(): Promise<void> {
    let result: { capabilities: Record<string, unknown> }
    try {
      result = (await withTimeout(
        this.connection.sendRequest('initialize', {
          processId: process.pid,
          rootUri: `file://${this.root}`,
          workspaceFolders: [{ uri: `file://${this.root}`, name: this.root.split('/').pop() }],
          initializationOptions: this.options.initializationOptions,
          capabilities: {
            textDocument: {
              synchronization: { didSave: true },
              publishDiagnostics: { relatedInformation: true },
              diagnostic: { dynamicRegistration: false },
              hover: { contentFormat: ['markdown', 'plaintext'] },
              completion: {
                completionItem: {
                  snippetSupport: false,
                  documentationFormat: ['markdown', 'plaintext']
                }
              },
              definition: {},
              typeDefinition: {},
              documentSymbol: { hierarchicalDocumentSymbolSupport: true }
            },
            workspace: {
              configuration: true,
              workspaceFolders: true,
              didChangeConfiguration: {}
            },
            window: { workDoneProgress: false }
          }
        }),
        this.options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS,
        `${this.name} initialize`
      )) as { capabilities: Record<string, unknown> }
    } catch (error) {
      // A hung or failed handshake must not leave a zombie process or a
      // pending promise: kill the server so the manager's restart logic runs.
      this.kill()
      throw error instanceof Error ? error : new Error(String(error))
    }
    this.capabilities = result.capabilities
    await this.connection.sendNotification('initialized', {})
    if (this.options.settings !== undefined) {
      await this.connection.sendNotification('workspace/didChangeConfiguration', {
        settings: this.options.settings
      })
    }
    this.state = 'running'
  }

  supportsPullDiagnostics(): boolean {
    return Boolean(this.capabilities.diagnosticProvider)
  }

  /**
   * Fire-and-forget notification, safe against the dispose race: the
   * connection throws synchronously when it was disposed (window close or
   * server crash) between instance lookup and the send.
   */
  notify(method: string, params: unknown): void {
    if (this.state === 'dead') return
    try {
      void this.connection.sendNotification(method, params)
    } catch {
      // connection closed mid-flight; the notification is moot
    }
  }

  kill(): void {
    this.killed = true // a deliberate kill must not be reported as a crash
    this.state = 'dead'
    try {
      this.connection.dispose()
    } catch {
      // already closed
    }
    this.child.kill()
  }
}
