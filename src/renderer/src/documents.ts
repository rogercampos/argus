import { EditorState, type Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/**
 * Document manager (spec 06): one document per file, shared by every view.
 * Each open file keeps a single EditorState (with its undo history) that
 * survives tab switches; autosave fires 700ms after the last edit; external
 * changes always win.
 */

export const AUTOSAVE_DELAY_MS = 700

export interface ManagedDocument {
  path: string
  state: EditorState
  extensions: Extension[]
  dirty: boolean
  /** scrollTop captured when the doc's view was last detached */
  lastScrollTop: number
  saveTimer: ReturnType<typeof setTimeout> | null
  /** epoch of the last content written by us, to skip self-triggered reloads */
  lastSavedText: string
}

type DirtyListener = (path: string, dirty: boolean) => void

export class DocumentManager {
  private docs = new Map<string, ManagedDocument>()
  private dirtyListeners = new Set<DirtyListener>()

  constructor(
    private readFileFn: (path: string) => Promise<string | null>,
    private writeFileFn: (path: string, content: string) => Promise<boolean>
  ) {}

  onDirtyChange(listener: DirtyListener): () => void {
    this.dirtyListeners.add(listener)
    return () => this.dirtyListeners.delete(listener)
  }

  private setDirty(doc: ManagedDocument, dirty: boolean): void {
    if (doc.dirty === dirty) return
    doc.dirty = dirty
    for (const l of this.dirtyListeners) l(doc.path, dirty)
  }

  get(path: string): ManagedDocument | undefined {
    return this.docs.get(path)
  }

  /** Open (or return the existing) document for a file. */
  async open(path: string, baseExtensions: Extension[]): Promise<ManagedDocument | null> {
    const existing = this.docs.get(path)
    if (existing) return existing

    const content = await this.readFileFn(path)
    if (content === null) return null

    const doc: ManagedDocument = {
      path,
      state: EditorState.create({ doc: content, extensions: baseExtensions }),
      extensions: baseExtensions,
      dirty: false,
      lastScrollTop: 0,
      saveTimer: null,
      lastSavedText: content
    }
    this.docs.set(path, doc)
    return doc
  }

  /** Called by the editor view on every update; keeps state + autosave. */
  noteViewUpdate(path: string, state: EditorState, docChanged: boolean): void {
    const doc = this.docs.get(path)
    if (!doc) return
    doc.state = state
    if (docChanged) {
      this.setDirty(doc, true)
      if (doc.saveTimer) clearTimeout(doc.saveTimer)
      doc.saveTimer = setTimeout(() => {
        void this.save(path)
      }, AUTOSAVE_DELAY_MS)
    }
  }

  async save(path: string): Promise<void> {
    const doc = this.docs.get(path)
    if (!doc?.dirty) return
    if (doc.saveTimer) {
      clearTimeout(doc.saveTimer)
      doc.saveTimer = null
    }
    const text = doc.state.doc.toString()
    doc.lastSavedText = text
    const ok = await this.writeFileFn(path, text)
    if (ok) this.setDirty(doc, false)
  }

  async saveAll(): Promise<void> {
    await Promise.all([...this.docs.keys()].map((p) => this.save(p)))
  }

  /**
   * External change handling (spec 06): reload from disk, even when dirty.
   * Preserves cursor offset (clamped); clears selection. Returns true if
   * the document content actually changed. If `attachedView` is given the
   * change is dispatched through it (keeping scroll); otherwise the stored
   * state is replaced.
   */
  async reloadFromDisk(path: string, attachedView: EditorView | null): Promise<boolean> {
    const doc = this.docs.get(path)
    if (!doc) return false
    const content = await this.readFileFn(path)
    if (content === null) return false
    if (content === doc.state.doc.toString()) return false
    // Our own autosave landing back via the watcher is not an external change
    if (content === doc.lastSavedText && !doc.dirty) return false

    if (doc.saveTimer) {
      clearTimeout(doc.saveTimer)
      doc.saveTimer = null
    }

    const cursor = Math.min(doc.state.selection.main.head, content.length)
    if (attachedView && attachedView.state === doc.state) {
      attachedView.dispatch({
        changes: { from: 0, to: doc.state.doc.length, insert: content },
        selection: { anchor: cursor }
      })
      doc.state = attachedView.state
    } else {
      doc.state = EditorState.create({
        doc: content,
        extensions: doc.extensions,
        selection: { anchor: cursor }
      })
    }
    doc.lastSavedText = content
    this.setDirty(doc, false)
    return true
  }

  /** Close a document, flushing any pending save first. */
  async close(path: string): Promise<void> {
    const doc = this.docs.get(path)
    if (!doc) return
    await this.save(path)
    this.docs.delete(path)
  }

  isDirty(path: string): boolean {
    return this.docs.get(path)?.dirty ?? false
  }
}
