import type { ChildProcess } from 'node:child_process'
import { basename } from 'node:path'
import type { Diagnostic } from 'vscode-languageserver-protocol'
import {
  createProtocolConnection,
  type ProtocolConnection,
  StreamMessageReader,
  StreamMessageWriter
} from 'vscode-languageserver-protocol/node'
import { trackedSpawn } from '../procRegistry'

/**
 * One running language server instance: process + jsonrpc connection +
 * lifecycle (spec 08).
 */

export interface LspInstanceOptions {
  name: string
  cmd: string
  args: string[]
  cwd: string
  env: Record<string, string>
  windowId?: number
  initializationOptions?: unknown
  settings?: unknown
  onDiagnostics: (uri: string, diagnostics: Diagnostic[]) => void
  onExit: () => void
}

export class LspInstance {
  private child: ChildProcess
  connection: ProtocolConnection
  capabilities: Record<string, unknown> = {}
  state: 'starting' | 'running' | 'dead' = 'starting'
  readonly name: string
  readonly root: string

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
    this.child.stderr?.on('data', () => {}) // drain
    this.child.on('exit', () => {
      this.state = 'dead'
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
    const result = (await this.connection.sendRequest('initialize', {
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
    })) as { capabilities: Record<string, unknown> }
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

  kill(): void {
    this.state = 'dead'
    try {
      this.connection.dispose()
    } catch {
      // already closed
    }
    this.child.kill()
  }
}
