import type { AppState } from './state';
import type { CanvasController, ViewState } from './canvas';
import type { HistorySnapshot } from './history';
import { serializeDocumentSVG, loadDocumentSVG, setProjectName } from '../ui/project-file';
import { getCloudDoc, setCloudDoc, clearCloudDoc } from '../lib/cloud-doc';

/** The cloud-project identity a tab is tethered to (null = a local/blank doc). */
interface TabCloudDoc { id: string; name: string; updatedAt: string }

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
  /** Which cloud project this tab maps to. Per-tab so autosave never writes one
   *  tab's content to another tab's cloud document. */
  cloudDoc: TabCloudDoc | null;
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
    return { id, title, svg: null, history: null, view: null, selection: [], dirty: false, cloudDoc: null };
  }

  private saveActiveIntoTab(): void {
    const t = this.active;
    t.svg = serializeDocumentSVG(this.state);
    t.history = this.state.exportHistory();
    t.view = this.canvas.getViewState();
    t.selection = [...this.state.selectedShapeIds];
    t.dirty = this.state.dirty;
    t.title = this.currentTitle();
    // Capture which cloud project this tab is tethered to, so it travels with the
    // tab and autosave targets the correct document after a switch.
    const cd = getCloudDoc();
    t.cloudDoc = cd.id ? { id: cd.id, name: cd.name ?? '', updatedAt: cd.updatedAt ?? '' } : null;
  }

  private loadTabIntoState(t: DocTab): void {
    if (t.svg == null) {
      this.state.clearAll(); // fresh blank document (default frame)
    } else {
      loadDocumentSVG(this.state, t.svg); // rebuilds content + defs, resets history & cloud tether
      if (t.history) this.state.importHistory(t.history);
      if (t.view) this.canvas.setViewState(t.view);
      const sel = t.selection.filter(id => this.state.findShapeById(id));
      if (sel.length) this.state.selectMultiple(sel);
    }
    // Re-tether the cloud identity to THIS tab's document (after load, which may
    // have cleared it). Without this, autosave would write here to the previous
    // tab's cloud row — silent cross-document data loss.
    if (t.cloudDoc) setCloudDoc(t.cloudDoc.id, t.cloudDoc.name, t.cloudDoc.updatedAt);
    else clearCloudDoc();
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
    setProjectName(this.active.title === 'Untitled' ? null : this.active.title);
  }

  /** Any tab (active or cached) with unsaved edits — for beforeunload. */
  anyDirty(): boolean {
    return this.state.dirty || this.tabs.some(t => t.id !== this.activeId && t.dirty);
  }
}
