import {
  autocompletion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import { type Diagnostic as CmDiagnostic, setDiagnostics } from '@codemirror/lint'
import { type Extension, RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  hoverTooltip,
  ViewPlugin,
  type ViewUpdate
} from '@codemirror/view'
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

  // Diagnostics surface only inside the editor (squiggles + hover) — there
  // is deliberately no workspace-wide problems report (removed 2026-06-11
  // by Roger).
  window.api.onLspDiagnostics(({ path, diagnostics }) => {
    diagnosticsByPath.set(path, diagnostics)
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

  return [hover, completions, cmdHoverLink(path)]
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
  const path = activeTabPath()
  const locations = await requestDefinition(kind)
  if (locations.length === 0) {
    if (path && isLspPath(path)) {
      useWorkspaceStore
        .getState()
        .showNotice('No definition found (the server may still be indexing)')
    }
    return
  }
  if (locations.length === 1) {
    const loc = locations[0]
    await useWorkspaceStore
      .getState()
      .navigateTo(loc.path, { line: loc.line + 1, col: loc.character + 1 })
    return
  }
  useWorkspaceStore.setState({ definitionChoices: locations })
}

/** Cmd+Click go-to-definition (spec 14). */
export function cmdClickDefinition(): Extension {
  return EditorView.domEventHandlers({
    mousedown: (event, view) => {
      if (!event.metaKey || event.button !== 0) return false
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos === null) return false
      view.dispatch({ selection: { anchor: pos } })
      void gotoDefinition('definition')
      return true // suppress normal selection behavior
    }
  })
}

const linkMark = Decoration.mark({ class: 'argus-cmd-link' })

/**
 * Cmd+hover affordance: while Cmd is held over a symbol, ask the server for
 * a definition and underline the word only when one exists — the underline
 * is a promise that Cmd+Click will navigate.
 */
class CmdHoverPlugin {
  decorations: DecorationSet = Decoration.none
  private mouse: { x: number; y: number } | null = null
  private metaHeld = false
  private checkTimer: ReturnType<typeof setTimeout> | null = null
  private shownRange: { from: number; to: number } | null = null
  /** word-range key → has definition, valid until the doc changes */
  private cache = new Map<string, boolean>()
  private requestSeq = 0
  private destroyed = false

  private onKey = (event: KeyboardEvent): void => {
    const held = event.metaKey
    if (held !== this.metaHeld) {
      this.metaHeld = held
      if (held) this.scheduleCheck()
      else this.clear()
    }
  }

  constructor(
    private view: EditorView,
    private path: string
  ) {
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.onKey)
  }

  onMouseMove(event: MouseEvent): void {
    this.mouse = { x: event.clientX, y: event.clientY }
    this.metaHeld = event.metaKey
    if (event.metaKey) this.scheduleCheck()
    else this.clear()
  }

  onMouseLeave(): void {
    this.mouse = null
    this.clear()
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      this.cache.clear()
      this.clear()
    }
  }

  destroy(): void {
    this.destroyed = true
    if (this.checkTimer) clearTimeout(this.checkTimer)
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('keyup', this.onKey)
  }

  private clear(): void {
    if (this.checkTimer) clearTimeout(this.checkTimer)
    if (this.shownRange) {
      this.shownRange = null
      this.decorations = Decoration.none
      this.view.dispatch({})
    }
  }

  private scheduleCheck(): void {
    if (this.checkTimer) clearTimeout(this.checkTimer)
    this.checkTimer = setTimeout(() => void this.check(), 60)
  }

  private async check(): Promise<void> {
    if (this.destroyed || !this.mouse || !this.metaHeld) return
    const pos = this.view.posAtCoords(this.mouse)
    if (pos === null) {
      this.clear()
      return
    }
    const word = this.view.state.wordAt(pos)
    if (!word) {
      this.clear()
      return
    }
    if (this.shownRange && this.shownRange.from === word.from && this.shownRange.to === word.to) {
      return // already underlined
    }

    const key = `${word.from}:${word.to}`
    let navigable = this.cache.get(key)
    if (navigable === undefined) {
      const seq = ++this.requestSeq
      const line = this.view.state.doc.lineAt(word.from)
      const locations = await window.api.lspDefinition(
        this.path,
        line.number - 1,
        word.from - line.from,
        'definition'
      )
      if (this.destroyed || seq !== this.requestSeq) return // stale
      navigable = locations.length > 0
      this.cache.set(key, navigable)
    }

    if (navigable && this.metaHeld && this.mouse) {
      // re-verify the mouse is still over the same word
      const current = this.view.posAtCoords(this.mouse)
      if (current === null || current < word.from || current > word.to) return
      this.shownRange = { from: word.from, to: word.to }
      const builder = new RangeSetBuilder<Decoration>()
      builder.add(word.from, word.to, linkMark)
      this.decorations = builder.finish()
      this.view.dispatch({})
    } else if (!navigable) {
      this.clear()
    }
  }
}

function cmdHoverLink(path: string): Extension {
  return ViewPlugin.define((view) => new CmdHoverPlugin(view, path), {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: {
      mousemove(event, _view) {
        this.onMouseMove(event)
      },
      mouseleave() {
        this.onMouseLeave()
      }
    }
  })
}
