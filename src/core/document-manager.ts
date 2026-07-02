import type { AppState } from './state';
import type { CanvasController, ViewState } from './canvas';
import type { HistorySnapshot } from './history';
import { serializeDocumentSVG, loadDocumentSVG } from '../ui/project-file';

/**
 * Multiple open documents as tabs. There is one live {@link AppState}; the ACTIVE
 * tab's document lives in it. Inactive tabs are held as a serialized snapshot
 * (full SVG incl. defs/metadata) plus their cached undo stack, viewport, and
 * selection. Switching a tab serializes the current document into its tab and
 * loads the target — so each tab keeps its own shapes, defs, undo history, zoom,
 * and selection. (Instant DOM-swap could avoid the serialize round-trip, but this
 * approach reuses the proven serialize/load path with far less rewiring.)
 */
export interface DocTab {
  id: string;
  title: string;
  svg: string | null;          // serialized doc for an inactive tab (null = active or blank)
  history: HistorySnapshot | null;
  view: ViewState | null;
  selection: string[];
  dirty: boolean;
}

export class DocumentManager {
  tabs: DocTab[] = [];
  activeId: string;
  private counter = 0;
  private readonly state: AppState;
  private readonly canvas: CanvasController;
  private readonly onChange: () => void;

  constructor(state: AppState, canvas: CanvasController, onChange: () => void) {
    this.state = state;
    this.canvas = canvas;
    this.onChange = onChange;
    // Tab 0 adopts the document already loaded into AppState at boot.
    const id = this.nextId();
    this.tabs.push(this.blankTab(id, 'Untitled'));
    this.activeId = id;
  }

  get active(): DocTab { return this.tabs.find(t => t.id === this.activeId)!; }

  private nextId(): string { return `doc-${++this.counter}`; }

  private blankTab(id: string, title: string): DocTab {
    return { id, title, svg: null, history: null, view: null, selection: [], dirty: false };
  }

  private saveActiveIntoTab(): void {
    const t = this.active;
    t.svg = serializeDocumentSVG(this.state);
    t.history = this.state.exportHistory();
    t.view = this.canvas.getViewState();
    t.selection = [...this.state.selectedShapeIds];
    t.dirty = this.state.dirty;
    t.title = this.currentTitle();
  }

  private loadTabIntoState(t: DocTab): void {
    if (t.svg == null) {
      this.state.clearAll(); // fresh blank document (default frame)
      return;
    }
    loadDocumentSVG(this.state, t.svg);   // rebuilds content + defs, resets history
    if (t.history) this.state.importHistory(t.history);
    if (t.view) this.canvas.setViewState(t.view);
    const sel = t.selection.filter(id => this.state.findShapeById(id));
    if (sel.length) this.state.selectMultiple(sel);
  }

  private currentTitle(): string {
    return document.getElementById('project-name')?.textContent?.trim() || 'Untitled';
  }

  newTab(): void {
    this.saveActiveIntoTab();
    const id = this.nextId();
    this.tabs.push(this.blankTab(id, `Untitled ${this.tabs.length + 1}`));
    this.activeId = id;
    this.loadTabIntoState(this.active); // clearAll → blank doc (fires state onChange)
    this.syncProjectName();
    this.onChange();
  }

  switchTo(id: string): void {
    if (id === this.activeId) return;
    const target = this.tabs.find(t => t.id === id);
    if (!target) return;
    this.saveActiveIntoTab();
    this.activeId = id;
    this.loadTabIntoState(target);
    this.syncProjectName();
    this.onChange();
  }

  /** Close a tab. Returns false if it was the last one (kept open). */
  closeTab(id: string): boolean {
    if (this.tabs.length <= 1) return false;
    const idx = this.tabs.findIndex(t => t.id === id);
    if (idx < 0) return false;
    const wasActive = id === this.activeId;
    this.tabs.splice(idx, 1);
    if (wasActive) {
      const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
      this.activeId = next.id;
      this.loadTabIntoState(next);
      this.syncProjectName();
    }
    this.onChange();
    return true;
  }

  /** Keep the active tab's title/dirty current (called from the render loop). */
  refreshActive(): void {
    this.active.title = this.currentTitle();
    this.active.dirty = this.state.dirty;
  }

  private syncProjectName(): void {
    const el = document.getElementById('project-name');
    if (el) el.textContent = this.active.title;
  }

  /** Any tab (active or cached) with unsaved edits — for beforeunload. */
  anyDirty(): boolean {
    return this.state.dirty || this.tabs.some(t => t.id !== this.activeId && t.dirty);
  }
}
