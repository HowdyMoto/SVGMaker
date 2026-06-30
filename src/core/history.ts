import type { HistoryEntry } from './types';

/**
 * Undo/redo bookkeeping: a linear stack of document snapshots with a
 * branch-on-edit model and a bounded depth.
 *
 * This class owns ONLY the navigation logic — the entry array, the current
 * index, the saved-baseline index (which drives `dirty`), and the depth cap.
 * Capturing and restoring the actual document is delegated to the two callbacks
 * supplied by the owner, so History has no knowledge of the SVG DOM or the
 * shape model. That callback seam is also where a future patch/command-based
 * undo would swap in: the navigation stays identical, only what a "snapshot" is
 * (full markup vs. a delta) changes.
 *
 * Extracted from AppState so the index-arithmetic — easy to get subtly wrong
 * (branch truncation, baseline tracking across the shift cap) — lives in one
 * small, focused unit instead of being threaded through the god object.
 */
export class History {
  private entries: HistoryEntry[] = [];
  private index = -1;
  /** Index whose document matches the last save/open/new (drives `dirty`). */
  private savedIndex = 0;
  private readonly capture: () => HistoryEntry;
  private readonly restore: (entry: HistoryEntry) => void;
  private readonly max: number;

  constructor(
    capture: () => HistoryEntry,
    restore: (entry: HistoryEntry) => void,
    max = 100,
  ) {
    this.capture = capture;
    this.restore = restore;
    this.max = max;
  }

  /** Capture the current document as a new entry at the head of the stack. */
  save(): void {
    const entry = this.capture();
    // Branching off before a saved-but-undone state discards that saved point.
    if (this.savedIndex > this.index) this.savedIndex = -1;
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(entry);
    if (this.entries.length > this.max) {
      this.entries.shift();
      this.savedIndex--;
    }
    this.index = this.entries.length - 1;
  }

  undo(): boolean {
    if (this.index <= 0) return false;
    this.index--;
    this.restore(this.entries[this.index]);
    return true;
  }

  redo(): boolean {
    if (this.index >= this.entries.length - 1) return false;
    this.index++;
    this.restore(this.entries[this.index]);
    return true;
  }

  get canUndo(): boolean { return this.index > 0; }
  get canRedo(): boolean { return this.index < this.entries.length - 1; }

  /** True when there are edits since the last save/open/new. */
  get dirty(): boolean { return this.index !== this.savedIndex; }

  /** Mark the current state as the saved baseline (call after save/open/new). */
  markClean(): void { this.savedIndex = this.index; }
}
