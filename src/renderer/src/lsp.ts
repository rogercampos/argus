import {
  autocompletion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import { type Diagnostic as CmDiagnostic, setDiagnostics } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'
import { type EditorView, hoverTooltip } from '@codemirror/view'
import type { LspDiagnostic, LspLocation } from '../../shared/types'
import { activeTabPath, activeView, documents, useWorkspaceStore } from './store'

/**
 * Renderer-side LSP glue (spec 08): document sync, diagnostics → CM lint,
 * hover tooltips, completion source, go-to-definition.
 */

const LSP_LANGS =
  /\.(rb|rake|gemspec|ru|ts|tsx|js|jsx|mjs|cjs|sh|bash|zsh)$|(^|\/)(Gemfile|Rakefile)$/

export function isLspPath(path: string): boolean {
  return LSP_LANGS.test(path)
}

/** path → latest diagnostics, applied to whichever view shows the doc */
const diagnosticsByPath = new Map<string, LspDiagnostic[]>()

export function diagnosticsFor(path: string): LspDiagnostic[] {
  return diagnosticsByPath.get(path) ?? []
}

function toCmDiagnostics(view: EditorView, list: LspDiagnostic[]): CmDiagnostic[] {
  const doc = view.state.doc
  const result: CmDiagnostic[] = []
  for (const d of list) {
    if (d.startLine >= doc.lines) continue
    const startLine = doc.line(d.startLine + 1)
    const endLine = d.endLine < doc.lines ? doc.line(d.endLine + 1) : startLine
    const from = Math.min(startLine.from + d.startChar, startLine.to)
    const to = Math.min(endLine.from + d.endChar, endLine.to)
    result.push({
      from,
      to: Math.max(from, to),
      severity: d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info',
      message: d.message,
      source: d.source
    })
  }
  return result
}

/** Re-apply stored diagnostics to the view currently showing `path`. */
export function applyDiagnosticsToView(view: EditorView, path: string): void {
  view.dispatch(setDiagnostics(view.state, toCmDiagnostics(view, diagnosticsFor(path))))
}

let initialized = false

export function initLsp(): void {
  if (initialized) return
  initialized = true

  window.api.onLspDiagnostics(({ path, diagnostics }) => {
    diagnosticsByPath.set(path, diagnostics)
    // diagnostics counts for the status bar
    let errors = 0
    let warnings = 0
    for (const list of diagnosticsByPath.values()) {
      for (const d of list) {
        if (d.severity === 1) errors++
        else if (d.severity === 2) warnings++
      }
    }
    // problems view data: files with diagnostics, sorted by path (spec 12)
    const problems = [...diagnosticsByPath.entries()]
      .filter(([, list]) => list.length > 0)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([p, list]) => ({ path: p, diagnostics: list }))
    useWorkspaceStore.setState({ diagnosticCounts: { errors, warnings }, problems })

    const view = activeView()
    if (view && activeTabPath() === path) applyDiagnosticsToView(view, path)
  })

  window.api.onLspProjects((projects) => {
    useWorkspaceStore.setState({ projects })
  })

  // document lifecycle → LSP
  documents.onOpen((path, text) => {
    if (isLspPath(path)) void window.api.lspDidOpen(path, text)
  })
  documents.onChangeText((path, text) => {
    if (isLspPath(path)) void window.api.lspDidChange(path, text)
  })
  documents.onClose((path) => {
    if (isLspPath(path)) void window.api.lspDidClose(path)
  })
}

function positionFor(view: EditorView, pos: number): { line: number; character: number } {
  const line = view.state.doc.lineAt(pos)
  return { line: line.number - 1, character: pos - line.from }
}

/** LSP-driven CM extensions for a document (added by the extensions builder). */
export function lspExtensions(path: string): Extension[] {
  if (!isLspPath(path)) return []

  const hover = hoverTooltip(async (view, pos) => {
    const { line, character } = positionFor(view, pos)
    const result = await window.api.lspHover(path, line, character)
    if (!result) return null
    return {
      pos,
      create: () => {
        const dom = document.createElement('div')
        dom.className = 'argus-hover'
        dom.textContent = result.contents.slice(0, 2000)
        return { dom }
      }
    }
  })

  const completions = autocompletion({
    override: [
      async (context: CompletionContext): Promise<CompletionResult | null> => {
        const word = context.matchBefore(/[\w.$]*/)
        if (!context.explicit && (!word || word.from === word.to)) return null
        const { line, character } = positionFor(context.view as EditorView, context.pos)
        const items = await window.api.lspCompletion(path, line, character)
        if (items.length === 0) return null
        return {
          from: word?.from ?? context.pos,
          options: items.map((item) => ({
            label: item.label,
            detail: item.detail,
            apply: item.insertText
          }))
        }
      }
    ]
  })

  return [hover, completions]
}

/** Go to definition (Cmd+B / menu). Returns locations for the picker. */
export async function requestDefinition(
  kind: 'definition' | 'typeDefinition'
): Promise<LspLocation[]> {
  const view = activeView()
  const path = activeTabPath()
  if (!view || !path || !isLspPath(path)) return []
  const { line, character } = positionFor(view, view.state.selection.main.head)
  return window.api.lspDefinition(path, line, character, kind)
}

export async function gotoDefinition(kind: 'definition' | 'typeDefinition'): Promise<void> {
  const locations = await requestDefinition(kind)
  if (locations.length === 0) return
  if (locations.length === 1) {
    const loc = locations[0]
    await useWorkspaceStore
      .getState()
      .navigateTo(loc.path, { line: loc.line + 1, col: loc.character + 1 })
    return
  }
  useWorkspaceStore.setState({ definitionChoices: locations })
}
