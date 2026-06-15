/**
 * A minimal language server speaking LSP over stdio, used as the "external
 * binary" in LSP integration tests. Deterministic canned answers:
 *  - didOpen/didChange publish one diagnostic carrying the doc text length
 *  - hover/definition/completion/workspace-symbol return fixed shapes
 *  - opening a document whose text contains "CRASH" kills the process
 */

let buffer = Buffer.alloc(0)

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) return
    const header = buffer.subarray(0, headerEnd).toString()
    const match = /Content-Length: (\d+)/i.exec(header)
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4)
      continue
    }
    const length = Number(match[1])
    if (buffer.length < headerEnd + 4 + length) return
    const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString()
    buffer = buffer.subarray(headerEnd + 4 + length)
    handle(JSON.parse(body))
  }
})

function send(message) {
  const body = JSON.stringify(message)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function publishDiagnostics(uri, text) {
  send({
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: {
      uri,
      diagnostics: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          severity: 2,
          message: `len:${text.length}`,
          source: 'fake'
        }
      ]
    }
  })
}

let rootUri = 'file:///'

function handle(message) {
  const { id, method, params } = message
  // Responses (e.g. to our client/registerCapability request) have no method.
  if (!method) return
  switch (method) {
    case 'initialize':
      // FAKE_LSP_HANG_INIT=1 simulates a server that spawns but never completes
      // the handshake, to exercise the client's initialize timeout.
      if (process.env.FAKE_LSP_HANG_INIT === '1') return
      rootUri = params.rootUri
      respond(id, {
        capabilities: {
          hoverProvider: true,
          completionProvider: {},
          definitionProvider: true,
          typeDefinitionProvider: true,
          workspaceSymbolProvider: true,
          diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false }
        }
      })
      // Like a real server (e.g. ruby-lsp), only register file watching when the
      // client advertised support for it.
      if (params.capabilities?.workspace?.didChangeWatchedFiles) {
        send({
          jsonrpc: '2.0',
          id: 'reg-watched-files',
          method: 'client/registerCapability',
          params: {
            registrations: [
              {
                id: 'watch-files',
                method: 'workspace/didChangeWatchedFiles',
                // two globs, to prove forwarding is driven by what the server
                // registered (not hard-coded to one language)
                registerOptions: {
                  watchers: [{ globPattern: '**/*.rb' }, { globPattern: '**/*.ts' }]
                }
              }
            ]
          }
        })
      }
      break
    case 'textDocument/didOpen':
      if (params.textDocument.text.includes('CRASH')) process.exit(1)
      publishDiagnostics(params.textDocument.uri, params.textDocument.text)
      break
    case 'textDocument/didChange':
      publishDiagnostics(params.textDocument.uri, params.contentChanges[0].text)
      break
    case 'workspace/didChangeWatchedFiles':
      // echo each change back as a diagnostic so tests can observe what arrived
      for (const change of params.changes) {
        send({
          jsonrpc: '2.0',
          method: 'textDocument/publishDiagnostics',
          params: {
            uri: change.uri,
            diagnostics: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                severity: 4,
                message: `watched:${change.type}`,
                source: 'fake-watch'
              }
            ]
          }
        })
      }
      break
    case 'textDocument/didClose':
      send({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri: params.textDocument.uri, diagnostics: [] }
      })
      break
    case 'textDocument/diagnostic':
      respond(id, {
        kind: 'full',
        items: [
          {
            range: { start: { line: 9, character: 0 }, end: { line: 9, character: 1 } },
            severity: 3,
            message: 'pulled diagnostic',
            source: 'fake-pull'
          }
        ]
      })
      break
    case 'textDocument/hover':
      respond(id, { contents: { kind: 'markdown', value: 'fake hover' } })
      break
    case 'textDocument/definition':
      respond(id, [
        {
          uri: params.textDocument.uri,
          range: { start: { line: 7, character: 3 }, end: { line: 7, character: 9 } }
        }
      ])
      break
    case 'textDocument/typeDefinition':
      // LocationLink shape, to exercise the targetUri/targetRange branch
      respond(id, [
        {
          targetUri: params.textDocument.uri,
          targetRange: { start: { line: 2, character: 1 }, end: { line: 2, character: 4 } },
          targetSelectionRange: { start: { line: 2, character: 1 }, end: { line: 2, character: 4 } }
        }
      ])
      break
    case 'textDocument/completion':
      respond(id, {
        items: [
          { label: 'fakeCompletion', kind: 6, detail: 'a canned item' },
          { label: 'withInsert', insertText: 'withInsert()' }
        ]
      })
      break
    case 'workspace/symbol':
      respond(id, [
        {
          name: 'FakeSymbol',
          kind: 5,
          location: {
            uri: `${rootUri}/src/app.ts`,
            range: { start: { line: 4, character: 0 }, end: { line: 4, character: 10 } }
          }
        },
        {
          name: 'StubFileSymbol',
          kind: 5,
          location: {
            uri: `${rootUri}/sorbet/rbi/stub.rbi`,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
          }
        }
      ])
      break
    case 'shutdown':
      respond(id, null)
      break
    case 'exit':
      process.exit(0)
      break
    default:
      if (id !== undefined) respond(id, null)
  }
}
