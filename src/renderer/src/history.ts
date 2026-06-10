/**
 * Visited-location history with back/forward (spec 05). Pure data structure;
 * the store does the navigation.
 */

export interface HistoryLocation {
  path: string
  cursorOffset: number
  scrollTop: number
}

const MAX_ENTRIES = 200

export class JumpHistory {
  private entries: HistoryLocation[] = []
  private index = -1 // points at the entry representing "where we are"

  /** Record a jump-from location. Truncates any forward entries. */
  record(location: HistoryLocation): void {
    // drop forward history
    this.entries = this.entries.slice(0, this.index + 1)
    const last = this.entries[this.entries.length - 1]
    if (last && last.path === location.path && last.cursorOffset === location.cursorOffset) {
      return // no consecutive duplicates
    }
    this.entries.push(location)
    if (this.entries.length > MAX_ENTRIES) this.entries.shift()
    this.index = this.entries.length - 1
  }

  /**
   * Step back. `current` is where the user is now — if we are at the head,
   * it is saved first so Forward can return to it.
   */
  back(current: HistoryLocation): HistoryLocation | null {
    if (this.entries.length === 0) return null
    if (this.index === this.entries.length - 1) {
      const head = this.entries[this.index]
      if (!head || head.path !== current.path || head.cursorOffset !== current.cursorOffset) {
        this.record(current)
      }
    }
    if (this.index <= 0) return null
    this.index -= 1
    return this.entries[this.index]
  }

  forward(): HistoryLocation | null {
    if (this.index >= this.entries.length - 1) return null
    this.index += 1
    return this.entries[this.index]
  }

  size(): number {
    return this.entries.length
  }
}
