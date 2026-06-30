import type { ToolName, ShapeData, HistoryEntry, ShapeStyle, Artboard, SymbolDef, GradientDef, GradientStop, PatternDef } from './types';
import { ensureSvgNamespaces } from './svg-ns';
import { sanitizePathData } from './path-sanitize';
import { sanitizeSvgElement, sanitizeSvgMarkup } from './svg-sanitize';
import { PathEditSession } from './path-edit';
import { nudgeTranslate, getRotation } from './transform';
import { applyStrokeAlignment, STROKE_CLIP_PREFIX } from './stroke-align';
import {
  type BooleanOp, ensureBooleanEngine, booleanEngineReady, computeBoolean, elementPathData,
  stripBooleanOperands, localPathData,
} from './boolean';

/** One copied shape, captured as serialized markup so paste is self-contained. */
interface ClipboardEntry {
  markup: string;
  type: ShapeData['type'];
  style: ShapeStyle;
  rotation?: number;
  symbolId?: string;
}

/**
 * Built-in editor chrome that lives in the canvas <defs> (the grid background
 * and transparency checkerboard). It must never be exported or re-imported:
 * their tiny corner paths render as stray lines in tools that read raw <path>
 * geometry and ignore <defs>/<pattern> structure (e.g. TraceCraft).
 */
const EDITOR_DEF_IDS = new Set(['grid-small', 'grid-large', 'transparency-check']);

export class AppState {
  currentTool: ToolName = 'select';
  shapes: ShapeData[] = [];
  get selectedShapeId(): string | null {
    return this.selectedShapeIds.length > 0 ? this.selectedShapeIds[this.selectedShapeIds.length - 1] : null;
  }
  /** Group the user has "entered" via double-click (Adobe-style isolation), so
   *  canvas clicks select its direct children instead of the group as a whole.
   *  null = top level. Isolation exit is driven by SelectTool; the scope is
   *  cleared automatically if the group is later deleted/ungrouped/undone. */
  activeGroupId: string | null = null;
  // Node-editing session (Direct Selection / Pen). Non-null while a path's
  // anchors are being edited; shared by the tools, overlay, and Properties panel.
  editingPathId: string | null = null;
  pathEdit: PathEditSession | null = null;

  /** Smart guides: snap drag/resize to the artboard and other objects. Toggled
   *  from View → Smart Guides; held ⌘/Ctrl bypasses it per-gesture. */
  snapEnabled = true;

  private idCounter = 0;
  private abCounter = 0;
  private history: HistoryEntry[] = [];
  private historyIndex = -1;
  private savedHistoryIndex = 0; // history index matching the last save/open/new
  private maxHistory = 100;
  private drawingLayer: SVGGElement;
  private onChangeCallback: () => void;

  artboards: Artboard[] = [];
  activeArtboardId: string | null = null;
  selectedArtboardId: string | null = null; // used by artboard tool

  // Which side-panel list the user last interacted with, so Delete/Backspace
  // targets the right thing ('layers' = shapes on canvas).
  activePanel: 'layers' | 'artboards' | 'symbols' = 'layers';
  selectedSymbolId: string | null = null;

  defaultStyle: ShapeStyle = {
    fill: '#FFFFFF',
    stroke: '#000000',
    strokeWidth: 1,
    opacity: 1,
    fillOpacity: 1,
    strokeOpacity: 1,
    fontSize: 24,
    fontFamily: 'Arial',
    fontWeight: 'normal',
    fontStyle: 'normal',
    strokeLinecap: 'butt',
    strokeLinejoin: 'miter',
    strokeMiterlimit: 4,
    strokeAlign: 'center',
    strokeDashoffset: 0,
    strokeNonScaling: false,
    rx: 0,
  };

  fillNone = false;
  strokeNone = false;
  showTransparency = true; // checkerboard background on by default

  /**
   * When true, "Export Active Artboard" bakes element transforms into geometry
   * so the SVG contains no transform attributes (for consumers that ignore
   * them, e.g. TraceCraft). Persisted across sessions; on by default.
   */
  bakeTransformsOnExport = (() => {
    try { return localStorage.getItem('svgmaker.bakeTransforms') !== 'false'; } catch { return true; }
  })();

  symbols: SymbolDef[] = [];
  private symbolCounter = 0;
  private defsElement: SVGDefsElement | null = null;

  gradients: GradientDef[] = [];
  private gradCounter = 0;
  patterns: PatternDef[] = [];
  private patternCounter = 0;

  constructor(drawingLayer: SVGGElement, onChange: () => void) {
    this.drawingLayer = drawingLayer;
    this.onChangeCallback = onChange;
    // Create default artboard
    this.artboards.push({
      id: this.nextArtboardId(),
      x: 0, y: 0,
      width: 960, height: 540,
      name: 'Artboard 1',
    });
    this.activeArtboardId = this.artboards[0].id;
    this.saveHistory();
    this.markClean();
  }

  // Keep the legacy getter for backward compat with align, export, etc.
  get artboard(): Artboard {
    return this.getActiveArtboard();
  }

  getActiveArtboard(): Artboard {
    return this.artboards.find(a => a.id === this.activeArtboardId) ?? this.artboards[0];
  }

  getArtboardById(id: string): Artboard | undefined {
    return this.artboards.find(a => a.id === id);
  }

  nextArtboardId(): string {
    return `ab-${++this.abCounter}`;
  }

  addArtboard(ab: Artboard): void {
    this.artboards.push(ab);
    this.activeArtboardId = ab.id;
    this.saveHistory();
    this.onChangeCallback();
  }

  /**
   * Duplicate an artboard along with the artwork sitting on it, placed to the
   * right of the rightmost artboard (the same slot the "+" button uses).
   */
  duplicateArtboard(id: string): void {
    const src = this.getArtboardById(id);
    if (!src) return;

    let maxRight = 0;
    for (const ab of this.artboards) maxRight = Math.max(maxRight, ab.x + ab.width);
    const dx = (maxRight + 40) - src.x;
    const dy = 0;

    // Clone every shape whose centre falls on the source artboard onto the copy.
    for (const shape of this.getShapesOnArtboard(id)) {
      const newEl = shape.element.cloneNode(true) as SVGElement;
      const newId = this.nextId();
      newEl.id = newId;
      if (shape.type === 'group') this.reIdGroupChildren(newEl);
      newEl.setAttribute('data-name', shape.name);
      this.drawingLayer.appendChild(newEl); // in the DOM so transform offsets resolve
      this.offsetElement(newEl, dx, dy);
      this.shapes.push({
        id: newId, type: shape.type, element: newEl, name: shape.name,
        style: { ...shape.style }, visible: shape.visible, locked: shape.locked,
        rotation: shape.rotation, symbolId: shape.symbolId,
      });
    }

    const copy: Artboard = {
      id: this.nextArtboardId(),
      x: src.x + dx, y: src.y + dy,
      width: src.width, height: src.height,
      name: `${src.name} copy`,
    };
    this.artboards.push(copy);
    this.activeArtboardId = copy.id;
    this.selectedArtboardId = copy.id;
    this.saveHistory();
    this.onChangeCallback();
  }

  removeArtboard(id: string): void {
    if (this.artboards.length <= 1) return; // Must keep at least one
    const idx = this.artboards.findIndex(a => a.id === id);
    if (idx === -1) return;
    this.artboards.splice(idx, 1);
    if (this.activeArtboardId === id) {
      this.activeArtboardId = this.artboards[0].id;
    }
    if (this.selectedArtboardId === id) {
      this.selectedArtboardId = null;
    }
    this.saveHistory();
    this.onChangeCallback();
  }

  updateArtboard(id: string, updates: Partial<Omit<Artboard, 'id'>>): void {
    const ab = this.artboards.find(a => a.id === id);
    if (!ab) return;
    Object.assign(ab, updates);
    this.onChangeCallback();
  }

  setActiveArtboard(id: string): void {
    this.activeArtboardId = id;
    this.onChangeCallback();
  }

  /** Get all shapes whose center falls within the given artboard */
  getShapesOnArtboard(abId: string): ShapeData[] {
    const ab = this.getArtboardById(abId);
    if (!ab) return [];
    return this.shapes.filter(shape => {
      try {
        const bbox = (shape.element as unknown as SVGGraphicsElement).getBBox();
        const cx = bbox.x + bbox.width / 2;
        const cy = bbox.y + bbox.height / 2;
        return cx >= ab.x && cx <= ab.x + ab.width && cy >= ab.y && cy <= ab.y + ab.height;
      } catch {
        return false;
      }
    });
  }

  onChange_public(): void {
    this.onChangeCallback();
  }

  /**
   * Re-sync emulated stroke-alignment clip-paths to current geometry, and prune
   * clips for shapes that are gone or no longer aligned. Called from the render
   * cycle so inside/outside strokes stay aligned after moves/resizes/loads.
   */
  refreshStrokeAlignClips(): void {
    const expected = new Set<string>();
    const visit = (shapes: ShapeData[]) => {
      for (const s of shapes) {
        const align = s.style.strokeAlign ?? 'center';
        if (align !== 'center' && s.element.isConnected) {
          expected.add(STROKE_CLIP_PREFIX + s.element.id);
          applyStrokeAlignment(s.element, s.type, align, s.style.strokeWidth);
        }
        if (s.children?.length) visit(s.children);
      }
    };
    visit(this.shapes);

    // Prune orphaned alignment clips.
    const defs = this.defsElement ?? this.drawingLayer.closest('svg')?.querySelector('defs');
    if (defs) {
      for (const child of Array.from(defs.children)) {
        if (child.id.startsWith(STROKE_CLIP_PREFIX) && !expected.has(child.id)) child.remove();
      }
    }
  }

  /**
   * True while a continuous pointer gesture (drag/resize/rotate) is in flight.
   * The renderer uses this to skip the expensive side-panel rebuilds on every
   * mousemove — only the canvas overlays need to follow the pointer live — and
   * does a full render once the gesture ends. Tools must clear it on mouseup.
   */
  interactive = false;

  /** Begin/end an interactive gesture (see `interactive`). */
  setInteractive(on: boolean): void {
    this.interactive = on;
  }

  nextId(): string {
    return `shape-${++this.idCounter}`;
  }

  addShape(shape: ShapeData): void {
    this.shapes.push(shape);
    this.drawingLayer.appendChild(shape.element);
    this.selectedShapeIds = [shape.id];
    this.saveHistory();
    this.onChangeCallback();
  }

  /** Find a shape and the array that directly contains it (handles nesting). */
  private locateShape(id: string, list: ShapeData[] = this.shapes): { shape: ShapeData; siblings: ShapeData[] } | null {
    for (const s of list) {
      if (s.id === id) return { shape: s, siblings: list };
      if (s.children) {
        const found = this.locateShape(id, s.children);
        if (found) return found;
      }
    }
    return null;
  }

  /** Remove a shape (top-level or nested inside a group) from model + DOM. */
  private detachShape(id: string): boolean {
    const loc = this.locateShape(id);
    if (!loc) return false;
    loc.shape.element.remove();
    this.shapeById.delete(id);
    const i = loc.siblings.indexOf(loc.shape);
    if (i >= 0) loc.siblings.splice(i, 1);
    return true;
  }

  removeShape(id: string): void {
    if (!this.detachShape(id)) return;
    this.selectedShapeIds = this.selectedShapeIds.filter(sid => sid !== id);
    this.clearStaleIsolation();
    this.saveHistory();
    this.onChangeCallback();
  }

  /** Remove the entire current selection in a single undo step. */
  removeSelected(): void {
    if (this.selectedShapeIds.length === 0) return;
    for (const id of [...this.selectedShapeIds]) this.detachShape(id);
    this.selectedShapeIds = [];
    this.clearStaleIsolation();
    this.saveHistory();
    this.onChangeCallback();
  }

  getSelectedShape(): ShapeData | null {
    if (!this.selectedShapeId) return null;
    return this.findShapeById(this.selectedShapeId);
  }

  selectShape(id: string | null): void {
    this.selectedShapeIds = id ? [id] : [];
    if (this.editingPathId && id !== this.editingPathId) this.exitPathEdit(false);
    this.onChangeCallback();
  }

  // ---- Group isolation (double-click to edit children on the canvas) ----

  /** Enter a group so canvas clicks select its direct children. No-op if `id`
   *  is not a group, or it's already the active scope. */
  enterGroup(id: string): void {
    const shape = this.findShapeById(id);
    if (shape?.type !== 'group' && shape?.type !== 'boolean') return;
    if (this.activeGroupId === id) return;
    this.exitGroupIsolation();
    this.activeGroupId = id;
    // Entering a live boolean reveals its operands for editing (CSS keyed on
    // data-bool-editing) and warms the engine so recompute stays synchronous.
    if (shape.type === 'boolean') {
      shape.element.setAttribute('data-bool-editing', '');
      void ensureBooleanEngine().then(() => this.onChangeCallback());
    }
    this.onChangeCallback();
  }

  /** Leave group isolation. No-op (and no render) when not isolated, so callers
   *  can invoke it unconditionally. */
  exitGroupIsolation(): void {
    if (!this.activeGroupId) return;
    this.findShapeById(this.activeGroupId)?.element.removeAttribute('data-bool-editing');
    this.activeGroupId = null;
    this.onChangeCallback();
  }

  /** Drop a dangling isolation scope when its group no longer exists (after
   *  delete / ungroup / undo). Cheap; called from the few mutation points. */
  private clearStaleIsolation(): void {
    if (this.activeGroupId && !this.findShapeById(this.activeGroupId)) this.activeGroupId = null;
  }

  // ---- Node editing ----

  /** Begin editing a path's anchors. No-op for non-path shapes. */
  enterPathEdit(id: string): boolean {
    const shape = this.findShapeById(id);
    if (!shape || shape.locked) return false;
    // A primitive boolean operand (rect/ellipse/…) has no anchors to edit; convert
    // it to an equivalent <path> in place the first time the user node-edits it.
    if (shape.type !== 'path') {
      if (!this.isBooleanOperand(shape) || !this.convertOperandToPath(shape)) return false;
    }
    const d = shape.element.getAttribute('d');
    if (!d) return false;
    this.editingPathId = id;
    this.pathEdit = new PathEditSession(d);
    this.selectedShapeIds = [id];
    this.onChangeCallback();
    return true;
  }

  exitPathEdit(notify = true): void {
    if (!this.editingPathId && !this.pathEdit) return;
    this.editingPathId = null;
    this.pathEdit = null;
    // Leaving node editing (incl. Escape mid-drag) ends any interactive gesture,
    // so the side-panel render guard can't get stuck on.
    this.interactive = false;
    if (notify) this.onChangeCallback();
  }

  /** Write the live model back to the element's `d`. `record` saves an undo step. */
  commitPathEdit(record = true): void {
    if (!this.editingPathId || !this.pathEdit) return;
    const shape = this.findShapeById(this.editingPathId);
    if (!shape) return;
    if (this.pathEdit.isEmpty) {
      // All nodes deleted — remove the now-empty path.
      this.removeShape(this.editingPathId);
      this.exitPathEdit();
      return;
    }
    shape.element.setAttribute('d', this.pathEdit.commit());
    if (record) this.saveHistory();
    this.onChangeCallback();
  }

  toggleVisibility(id: string): void {
    const shape = this.findShapeById(id);
    if (!shape) return;
    shape.visible = !shape.visible;
    (shape.element as SVGElement).style.display = shape.visible ? '' : 'none';
    this.saveHistory();
    this.onChangeCallback();
  }

  toggleLock(id: string): void {
    const shape = this.findShapeById(id);
    if (!shape) return;
    shape.locked = !shape.locked;
    // Mirror onto the element so the lock survives history (which snapshots the
    // drawing layer's markup) and round-trips through rebuildShapesFromDOM.
    if (shape.locked) shape.element.setAttribute('data-locked', 'true');
    else shape.element.removeAttribute('data-locked');
    this.saveHistory();
    this.onChangeCallback();
  }

  /** Make every top-level shape visible again. */
  showAll(): void {
    for (const s of this.shapes) {
      s.visible = true;
      (s.element as SVGElement).style.display = '';
    }
    this.saveHistory();
    this.onChangeCallback();
  }

  /** Unlock every top-level shape. */
  unlockAll(): void {
    for (const s of this.shapes) {
      s.locked = false;
      s.element.removeAttribute('data-locked');
    }
    this.saveHistory();
    this.onChangeCallback();
  }

  moveShapeUp(id: string): void {
    const idx = this.shapes.findIndex(s => s.id === id);
    if (idx < this.shapes.length - 1) {
      const shape = this.shapes[idx];
      const nextShape = this.shapes[idx + 1];
      this.shapes[idx] = nextShape;
      this.shapes[idx + 1] = shape;
      this.drawingLayer.insertBefore(nextShape.element, shape.element);
      this.saveHistory();
      this.onChangeCallback();
    }
  }

  moveShapeDown(id: string): void {
    const idx = this.shapes.findIndex(s => s.id === id);
    if (idx > 0) {
      const shape = this.shapes[idx];
      const prevShape = this.shapes[idx - 1];
      this.shapes[idx] = prevShape;
      this.shapes[idx - 1] = shape;
      this.drawingLayer.insertBefore(shape.element, prevShape.element);
      this.saveHistory();
      this.onChangeCallback();
    }
  }

  /**
   * Drag-and-drop reorder/reparent from the Layers panel.
   *
   * The Layers panel lists shapes top-to-bottom in REVERSE paint order (top of
   * the list = top of the z-stack = last in the DOM). `position` is expressed
   * in that visual order: 'before' = above the target in the panel (so later in
   * the DOM), 'after' = below it, 'inside' = into the target group.
   *
   * We mutate the live DOM then rebuild the model from it, so the two never
   * drift. When the parent changes, the element's transform is recomputed so it
   * keeps its on-screen position (no jump when dropping into a moved group).
   */
  moveShape(draggedId: string, targetId: string, position: 'before' | 'after' | 'inside'): boolean {
    if (draggedId === targetId) return false;
    const dragged = this.findShapeById(draggedId);
    const target = this.findShapeById(targetId);
    if (!dragged || !target) return false;

    const dEl = dragged.element;
    const tEl = target.element;
    // Never drop a group into its own subtree.
    if (dEl === tEl || dEl.contains(tEl)) return false;

    const oldParent = dEl.parentNode;
    const oldScreen = (dEl as unknown as SVGGraphicsElement).getScreenCTM();

    if (position === 'inside') {
      if (target.type !== 'group') return false;
      tEl.appendChild(dEl); // top of the group's stack
    } else {
      const parent = tEl.parentNode;
      if (!parent) return false;
      // Panel order is reversed vs. the DOM, so 'before' goes after the target.
      parent.insertBefore(dEl, position === 'before' ? tEl.nextSibling : tEl);
    }

    // Preserve on-screen position when the parent changed (reparent).
    const newParent = dEl.parentNode;
    if (newParent !== oldParent && oldScreen) {
      const pScreen = (newParent as unknown as SVGGraphicsElement).getScreenCTM?.();
      if (pScreen) {
        const m = pScreen.inverse().multiply(oldScreen);
        const r = (v: number) => Math.round(v * 1e6) / 1e6;
        dEl.setAttribute('transform', `matrix(${r(m.a)} ${r(m.b)} ${r(m.c)} ${r(m.d)} ${r(m.e)} ${r(m.f)})`);
      }
    }

    this.rebuildShapesFromDOM();
    this.selectedShapeIds = [draggedId];
    this.saveHistory();
    this.onChangeCallback();
    return true;
  }

  /**
   * Wrap `targetId` and `draggedId` in a NEW group, created at the target's
   * position/parent. Used when dragging one layer directly onto another (the
   * middle of a non-group row). The dragged element keeps its on-screen
   * position; the target does too (the new group is identity and sits where
   * the target was).
   */
  groupShapes(draggedId: string, targetId: string): boolean {
    if (draggedId === targetId) return false;
    const dragged = this.findShapeById(draggedId);
    const target = this.findShapeById(targetId);
    if (!dragged || !target) return false;

    const dEl = dragged.element;
    const tEl = target.element;
    if (dEl === tEl || dEl.contains(tEl) || tEl.contains(dEl)) return false;
    const parent = tEl.parentNode;
    if (!parent) return false;

    const dOldParent = dEl.parentNode;
    const dOldScreen = (dEl as unknown as SVGGraphicsElement).getScreenCTM();

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const id = this.nextId();
    g.id = id;
    g.setAttribute('data-name', `Group ${id.replace('shape-', '#')}`);
    parent.insertBefore(g, tEl); // take the target's slot in the stack
    g.appendChild(tEl);          // target on the bottom
    g.appendChild(dEl);          // dragged on top

    // The dragged element's parent changed — compensate so it doesn't jump.
    if (dOldParent !== g && dOldScreen) {
      const pScreen = (g as unknown as SVGGraphicsElement).getScreenCTM?.();
      if (pScreen) {
        const m = pScreen.inverse().multiply(dOldScreen);
        const r = (v: number) => Math.round(v * 1e6) / 1e6;
        dEl.setAttribute('transform', `matrix(${r(m.a)} ${r(m.b)} ${r(m.c)} ${r(m.d)} ${r(m.e)} ${r(m.f)})`);
      }
    }

    this.rebuildShapesFromDOM();
    this.selectedShapeIds = [id];
    this.saveHistory();
    this.onChangeCallback();
    return true;
  }

  /** Re-append top-level shape elements so DOM paint order matches `this.shapes`. */
  private syncDomOrder(): void {
    for (const s of this.shapes) this.drawingLayer.appendChild(s.element);
  }

  /** Move the selected top-level shapes to the top of the z-order. */
  bringToFront(): void {
    const ids = new Set(this.selectedShapeIds);
    const selected = this.shapes.filter(s => ids.has(s.id));
    if (selected.length === 0) return;
    const rest = this.shapes.filter(s => !ids.has(s.id));
    this.shapes = [...rest, ...selected];
    this.syncDomOrder();
    this.saveHistory();
    this.onChangeCallback();
  }

  /** Move the selected top-level shapes to the bottom of the z-order. */
  sendToBack(): void {
    const ids = new Set(this.selectedShapeIds);
    const selected = this.shapes.filter(s => ids.has(s.id));
    if (selected.length === 0) return;
    const rest = this.shapes.filter(s => !ids.has(s.id));
    this.shapes = [...selected, ...rest];
    this.syncDomOrder();
    this.saveHistory();
    this.onChangeCallback();
  }

  duplicateShape(id: string): void {
    const newId = this.cloneShapeById(id);
    if (!newId) return;
    this.selectedShapeIds = [newId];
    this.saveHistory();
    this.onChangeCallback();
  }

  /** Duplicate the entire current selection in a single undo step. */
  duplicateSelected(): void {
    const ids = [...this.selectedShapeIds];
    if (ids.length === 0) return;
    const newIds: string[] = [];
    for (const id of ids) {
      const newId = this.cloneShapeById(id);
      if (newId) newIds.push(newId);
    }
    if (newIds.length === 0) return;
    this.selectedShapeIds = newIds;
    this.saveHistory();
    this.onChangeCallback();
  }

  /**
   * Clone a shape into the drawing layer offset by 10px, returning the new id.
   * Does NOT record history / select / notify — callers batch those so a
   * multi-duplicate is one undo step.
   */
  private cloneShapeById(id: string): string | null {
    const shape = this.shapes.find(s => s.id === id);
    if (!shape) return null;
    const newEl = shape.element.cloneNode(true) as SVGElement;
    const newId = this.nextId();
    newEl.id = newId;
    // Re-id descendants so a duplicated group doesn't share child ids with the
    // original (which corrupts findShapeById / idCounter after a history rebuild).
    if (shape.type === 'group') this.reIdGroupChildren(newEl);
    const bbox = (shape.element as unknown as SVGGraphicsElement).getBBox();
    const tag = newEl.tagName.toLowerCase();
    if (tag === 'rect' || tag === 'text') {
      newEl.setAttribute('x', String(bbox.x + 10));
      newEl.setAttribute('y', String(bbox.y + 10));
    } else if (tag === 'ellipse') {
      newEl.setAttribute('cx', String(parseFloat(newEl.getAttribute('cx') ?? '0') + 10));
      newEl.setAttribute('cy', String(parseFloat(newEl.getAttribute('cy') ?? '0') + 10));
    }
    const name = `${shape.type} ${newId.replace('shape-', '#')}`;
    newEl.setAttribute('data-name', name);
    this.shapes.push({
      id: newId, type: shape.type, element: newEl, name,
      style: { ...shape.style }, visible: true, locked: false,
      rotation: shape.rotation, symbolId: shape.symbolId,
    });
    this.drawingLayer.appendChild(newEl);
    return newId;
  }

  // ---- Clipboard ----
  private clipboard: ClipboardEntry[] = [];
  private pasteOffset = 0;

  private snapshotShape(shape: ShapeData): ClipboardEntry {
    return {
      markup: shape.element.outerHTML,
      type: shape.type,
      style: { ...shape.style },
      rotation: shape.rotation,
      symbolId: shape.symbolId,
    };
  }

  /** Replace the clipboard and mirror it to the system clipboard for cross-app paste. */
  private setClipboard(entries: ClipboardEntry[]): void {
    this.clipboard = entries;
    this.pasteOffset = 0;
    const markup = entries.map(e => e.markup).join('');
    const svgWrapper = `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`;
    navigator.clipboard?.writeText(svgWrapper).catch(() => { /* ignore */ });
  }

  copyShape(id: string): void {
    const shape = this.shapes.find(s => s.id === id);
    if (!shape) return;
    this.setClipboard([this.snapshotShape(shape)]);
  }

  /**
   * Copy the whole current selection (in selection order), resolving nested
   * shapes too so cut copies exactly what removeSelected deletes.
   */
  copySelected(): void {
    const shapes = this.selectedShapeIds
      .map(id => this.findShapeById(id))
      .filter((s): s is ShapeData => s !== null);
    if (shapes.length === 0) return;
    this.setClipboard(shapes.map(s => this.snapshotShape(s)));
  }

  cutShape(id: string): void {
    this.copyShape(id);
    this.removeShape(id);
  }

  cutSelected(): void {
    this.copySelected();
    this.removeSelected();
  }

  /** Paste the internal clipboard. Returns true if anything was pasted. */
  pasteClipboard(): boolean {
    if (this.clipboard.length === 0) return false;
    this.pasteOffset += 10;
    const newIds: string[] = [];
    for (const entry of this.clipboard) {
      const id = this.insertClipboardEntry(entry, this.pasteOffset);
      if (id) newIds.push(id);
    }
    if (newIds.length === 0) return false;
    this.selectedShapeIds = newIds;
    this.saveHistory();
    this.onChangeCallback();
    return true;
  }

  /** Materialize one clipboard entry into the drawing layer; returns the new id. */
  private insertClipboardEntry(entry: ClipboardEntry, offset: number): string | null {
    const parser = new DOMParser();
    const doc = parser.parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${entry.markup}</svg>`,
      'image/svg+xml'
    );
    const srcEl = doc.querySelector('svg')?.firstElementChild as SVGElement | null;
    if (!srcEl) return null;

    const newEl = document.importNode(srcEl, true) as SVGElement;
    sanitizeSvgElement(newEl); // strip event handlers / unsafe refs from untrusted markup
    const newId = this.nextId();
    newEl.id = newId;
    const name = `${entry.type} ${newId.replace('shape-', '#')}`;
    newEl.setAttribute('data-name', name);

    // Offset so the paste doesn't land exactly on top of the original.
    this.offsetElement(newEl, offset, offset);

    // Re-id nested children so a pasted group doesn't collide with the source.
    if (entry.type === 'group') this.reIdGroupChildren(newEl);

    this.shapes.push({
      id: newId,
      type: entry.type,
      element: newEl,
      name,
      style: { ...entry.style },
      visible: true,
      locked: false,
      rotation: entry.rotation,
      symbolId: entry.symbolId,
    });
    this.drawingLayer.appendChild(newEl);
    return newId;
  }

  /** Try to paste SVG content from the system clipboard */
  async pasteFromSystemClipboard(): Promise<boolean> {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.includes('<svg') && !text.includes('<SVG')) return false;

      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'image/svg+xml');
      const svgEl = doc.querySelector('svg');
      if (!svgEl) return false;


      let pasted = false;
      for (let i = 0; i < svgEl.children.length; i++) {
        const child = svgEl.children[i];
        const imported = document.importNode(child, true) as SVGElement;
        sanitizeSvgElement(imported); // untrusted system-clipboard SVG
        const type = this.detectType(imported);
        if (!type) continue;

        const id = this.nextId();
        imported.id = id;
        const name = `${type} ${id.replace('shape-', '#')}`;
        imported.setAttribute('data-name', name);

        this.addShape({
          id, type, element: imported, name,
          style: this.readStyle(imported, type),
          visible: true, locked: false,
        });
        pasted = true;
      }
      return pasted;
    } catch {
      return false;
    }
  }

  private offsetElement(el: SVGElement, dx: number, dy: number): void {
    const tag = el.tagName.toLowerCase();
    if (tag === 'rect' || tag === 'text' || tag === 'image' || tag === 'use') {
      el.setAttribute('x', String(parseFloat(el.getAttribute('x') ?? '0') + dx));
      el.setAttribute('y', String(parseFloat(el.getAttribute('y') ?? '0') + dy));
    } else if (tag === 'ellipse') {
      el.setAttribute('cx', String(parseFloat(el.getAttribute('cx') ?? '0') + dx));
      el.setAttribute('cy', String(parseFloat(el.getAttribute('cy') ?? '0') + dy));
    } else if (tag === 'line') {
      el.setAttribute('x1', String(parseFloat(el.getAttribute('x1') ?? '0') + dx));
      el.setAttribute('y1', String(parseFloat(el.getAttribute('y1') ?? '0') + dy));
      el.setAttribute('x2', String(parseFloat(el.getAttribute('x2') ?? '0') + dx));
      el.setAttribute('y2', String(parseFloat(el.getAttribute('y2') ?? '0') + dy));
    } else if (tag === 'polyline' || tag === 'polygon') {
      const points = el.getAttribute('points') ?? '';
      const pairs = points.trim().split(/\s+/).map(p => p.split(',').map(Number));
      const newPoints = pairs.map(([px, py]) => `${px + dx},${py + dy}`).join(' ');
      el.setAttribute('points', newPoints);
    } else if (tag === 'path' || tag === 'g') {
      nudgeTranslate(el, dx, dy);
    }
  }

  private reIdGroupChildren(groupEl: SVGElement): void {
    for (let i = 0; i < groupEl.children.length; i++) {
      const child = groupEl.children[i] as SVGElement;
      if (child.id) {
        child.id = this.nextId();
      }
      if (child.tagName.toLowerCase() === 'g') {
        this.reIdGroupChildren(child);
      }
    }
  }

  saveHistory(): void {
    // When isolated inside a live boolean, an operand was likely just edited —
    // refresh the cached result path before it is serialized. Synchronous: the
    // engine was warmed on isolation entry (see enterGroup).
    if (this.activeGroupId && booleanEngineReady()) {
      const active = this.findShapeById(this.activeGroupId);
      if (active?.type === 'boolean') this.recomputeBoolean(active.element);
    }
    // Transient editor-only artifacts must never reach a history snapshot: the
    // `data-bool-editing` reveal hook (would survive undo and show operands) and
    // any live Pathfinder hover-preview ghost.
    this.drawingLayer.querySelectorAll('[data-boolean-preview]').forEach((p) => p.remove());
    const editing = this.drawingLayer.querySelectorAll('[data-bool-editing]');
    editing.forEach((w) => w.removeAttribute('data-bool-editing'));
    const svgContent = this.drawingLayer.innerHTML;
    editing.forEach((w) => w.setAttribute('data-bool-editing', ''));

    const entry: HistoryEntry = {
      svgContent,
      selectedId: this.selectedShapeId,
      artboardsJson: JSON.stringify(this.artboards),
    };
    // Branching off before a saved-but-undone state discards that saved point.
    if (this.savedHistoryIndex > this.historyIndex) this.savedHistoryIndex = -1;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
      this.savedHistoryIndex--;
    }
    this.historyIndex = this.history.length - 1;
  }

  /** True when there are edits since the last save/open/new. */
  get dirty(): boolean { return this.historyIndex !== this.savedHistoryIndex; }

  /** Mark the current state as the saved baseline (call after save/open/new). */
  markClean(): void { this.savedHistoryIndex = this.historyIndex; }

  undo(): boolean {
    if (this.historyIndex <= 0) return false;
    this.historyIndex--;
    this.restoreHistory(this.history[this.historyIndex]);
    return true;
  }

  redo(): boolean {
    if (this.historyIndex >= this.history.length - 1) return false;
    this.historyIndex++;
    this.restoreHistory(this.history[this.historyIndex]);
    return true;
  }

  get canUndo(): boolean { return this.historyIndex > 0; }
  get canRedo(): boolean { return this.historyIndex < this.history.length - 1; }

  private restoreHistory(entry: HistoryEntry): void {
    // History holds already-sanitized markup, but re-sanitize so the invariant
    // "drawingLayer.innerHTML is never assigned unsanitized content" holds at
    // every sink unconditionally (defense in depth; undo/redo isn't hot).
    this.drawingLayer.innerHTML = sanitizeSvgMarkup(entry.svgContent);
    this.rebuildShapesFromDOM();
    this.selectedShapeIds = entry.selectedId ? [entry.selectedId] : [];
    // The new DOM lost the transient editing marker (scrubbed before snapshot).
    // Re-apply it if we're still isolated inside a boolean, so operands re-reveal.
    this.clearStaleIsolation();
    if (this.activeGroupId) {
      const active = this.findShapeById(this.activeGroupId);
      if (active?.type === 'boolean') active.element.setAttribute('data-bool-editing', '');
      else this.activeGroupId = null;
    }
    // Keep any node-editing session in sync with the restored geometry.
    if (this.editingPathId) {
      const shape = this.findShapeById(this.editingPathId);
      const d = shape?.element.getAttribute('d');
      if (shape && shape.type === 'path' && d) this.pathEdit = new PathEditSession(d);
      else this.exitPathEdit(false);
    }
    try {
      this.artboards = JSON.parse(entry.artboardsJson);
      // Restore abCounter
      let maxAb = 0;
      for (const ab of this.artboards) {
        const m = ab.id.match(/ab-(\d+)/);
        if (m) maxAb = Math.max(maxAb, parseInt(m[1]));
      }
      this.abCounter = Math.max(this.abCounter, maxAb);
      if (!this.artboards.find(a => a.id === this.activeArtboardId)) {
        this.activeArtboardId = this.artboards[0]?.id ?? null;
      }
    } catch { /* keep current artboards */ }
    this.onChangeCallback();
  }

  rebuildShapesFromDOM(): void {
    this.shapes = [];
    this.shapeById.clear(); // shapes are rebuilt from scratch; drop stale cache
    const elements = this.drawingLayer.children;
    let maxId = 0;

    const processElement = (el: SVGElement): ShapeData | null => {
      const id = el.id;
      if (!id) return null;
      const numMatch = id.match(/shape-(\d+)/);
      if (numMatch) {
        const num = parseInt(numMatch[1]);
        if (num > maxId) maxId = num;
      }
      const type = this.detectType(el);
      if (!type) return null;

      const shape: ShapeData = {
        id, type, element: el,
        name: el.getAttribute('data-name') || `${type} ${id.replace('shape-', '#')}`,
        style: this.readStyle(el, type),
        visible: el.style.display !== 'none',
        locked: el.getAttribute('data-locked') === 'true',
      };

      // Read rotation from the transform list (robust to matrix()/ordering).
      const rot = getRotation(el);
      if (rot) shape.rotation = rot;

      // Rebuild children for groups
      if (type === 'group') {
        shape.children = [];
        for (let j = 0; j < el.children.length; j++) {
          const child = processElement(el.children[j] as SVGElement);
          if (child) {
            child.parentId = id;
            shape.children.push(child);
          }
        }
      }

      // A live boolean's children are its operands (marked elements); the
      // <path data-bool-result> sibling is a managed cache, not a shape.
      if (type === 'boolean') {
        shape.booleanOp = (el.getAttribute('data-boolean') as ShapeData['booleanOp']) ?? 'unite';
        shape.children = [];
        for (let j = 0; j < el.children.length; j++) {
          const childEl = el.children[j] as SVGElement;
          if (!childEl.hasAttribute('data-bool-operand')) continue;
          const child = processElement(childEl);
          if (child) {
            child.parentId = id;
            shape.children.push(child);
          }
        }
      }

      return shape;
    };

    for (let i = 0; i < elements.length; i++) {
      const shape = processElement(elements[i] as SVGElement);
      if (shape) this.shapes.push(shape);
    }
    this.idCounter = Math.max(this.idCounter, maxId);
    this.clearStaleIsolation();
  }

  private detectType(el: SVGElement): ShapeData['type'] | null {
    const tag = el.tagName.toLowerCase();
    if (tag === 'rect') return 'rect';
    if (tag === 'ellipse') return 'ellipse';
    if (tag === 'line') return 'line';
    if (tag === 'polyline') return 'polyline';
    if (tag === 'polygon') return 'polygon';
    if (tag === 'path') return 'path';
    if (tag === 'text') return 'text';
    if (tag === 'g') return el.hasAttribute('data-boolean') ? 'boolean' : 'group';
    if (tag === 'image') return 'image';
    if (tag === 'use') return 'use';
    return null;
  }

  /**
   * SVGs imported from other tools (e.g. Inkscape) keep their paint in the CSS
   * `style` attribute, which overrides presentation attributes. SVGMaker reads
   * and writes presentation attributes, so promote any inline paint properties
   * to attributes (and drop them from `style`) so both stay in sync.
   */
  private flattenInlineStyle(el: SVGElement): void {
    if (!el.getAttribute('style')) return;
    const props = [
      'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
      'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity',
      'font-size', 'font-family', 'font-weight', 'font-style', 'rx',
    ];
    for (const prop of props) {
      const val = el.style.getPropertyValue(prop);
      if (val) {
        el.setAttribute(prop, val); // inline style wins, so overwrite the attribute
        el.style.removeProperty(prop);
      }
    }
    if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
  }

  private readStyle(el: SVGElement, type: ShapeData['type']): ShapeStyle {
    this.flattenInlineStyle(el);
    if (type === 'group' || type === 'image' || type === 'use' || type === 'boolean') {
      return {
        fill: el.getAttribute('fill') ?? 'none',
        stroke: el.getAttribute('stroke') ?? 'none',
        strokeWidth: parseFloat(el.getAttribute('stroke-width') ?? '0'),
        opacity: parseFloat(el.getAttribute('opacity') ?? '1'),
      };
    }
    const fill = el.getAttribute('fill') ?? (type === 'line' ? 'none' : '#FFFFFF');
    const stroke = el.getAttribute('stroke') ?? '#000000';
    // Inside/outside alignment renders at double width (see stroke-align.ts);
    // the data-stroke-align marker lets us recover the authored width.
    const align = el.getAttribute('data-stroke-align');
    const rawWidth = parseFloat(el.getAttribute('stroke-width') ?? '1');
    const strokeWidth = (align === 'inside' || align === 'outside') ? rawWidth / 2 : rawWidth;
    const opacity = parseFloat(el.getAttribute('opacity') ?? '1');
    const style: ShapeStyle = { fill, stroke, strokeWidth, opacity };
    style.fillOpacity = parseFloat(el.getAttribute('fill-opacity') ?? '1');
    style.strokeOpacity = parseFloat(el.getAttribute('stroke-opacity') ?? '1');
    style.strokeAlign = (align === 'inside' || align === 'outside') ? align : 'center';
    style.strokeLinecap = el.getAttribute('stroke-linecap') ?? 'butt';
    style.strokeLinejoin = el.getAttribute('stroke-linejoin') ?? 'miter';
    style.strokeMiterlimit = parseFloat(el.getAttribute('stroke-miterlimit') ?? '4');
    style.strokeDasharray = el.getAttribute('stroke-dasharray') ?? '';
    style.strokeDashoffset = parseFloat(el.getAttribute('stroke-dashoffset') ?? '0');
    style.strokeNonScaling = (el.getAttribute('vector-effect') ?? '').includes('non-scaling-stroke');
    if (type === 'rect') {
      style.rx = parseFloat(el.getAttribute('rx') ?? '0');
    }
    if (type === 'text') {
      style.fontSize = parseFloat(el.getAttribute('font-size') ?? '24');
      style.fontFamily = el.getAttribute('font-family') ?? 'Arial';
      style.fontWeight = el.getAttribute('font-weight') ?? 'normal';
      style.fontStyle = el.getAttribute('font-style') ?? 'normal';
    }
    return style;
  }

  // Multi-selection support
  selectedShapeIds: string[] = [];

  selectMultiple(ids: string[]): void {
    this.selectedShapeIds = ids;
    this.onChangeCallback();
  }

  toggleMultiSelect(id: string): void {
    const idx = this.selectedShapeIds.indexOf(id);
    if (idx >= 0) {
      this.selectedShapeIds.splice(idx, 1);
    } else {
      this.selectedShapeIds.push(id);
    }
    this.onChangeCallback();
  }

  /**
   * Fast id→shape lookup cache. Entries are validated on read (a removed shape's
   * element is disconnected, a stale entry's id won't match) and refilled from a
   * tree walk on miss, so the cache is always correct even if a mutation site
   * forgets to update it — it only ever falls back to the old O(n) behavior.
   */
  private shapeById = new Map<string, ShapeData>();

  findShapeById(id: string, list?: ShapeData[]): ShapeData | null {
    // Caller-scoped searches (passing an explicit subtree) bypass the cache.
    if (list) return this.walkFindShape(id, list);

    const cached = this.shapeById.get(id);
    if (cached && cached.id === id && cached.element.isConnected) return cached;

    const found = this.walkFindShape(id, this.shapes);
    if (found) this.shapeById.set(id, found);
    else this.shapeById.delete(id);
    return found;
  }

  private walkFindShape(id: string, list: ShapeData[]): ShapeData | null {
    for (const s of list) {
      if (s.id === id) return s;
      if (s.children) {
        const found = this.walkFindShape(id, s.children);
        if (found) return found;
      }
    }
    return null;
  }

  groupSelectedShapes(): void {
    const ids = this.selectedShapeIds.length > 1
      ? this.selectedShapeIds
      : this.shapes.filter(s => this.selectedShapeIds.includes(s.id) || s.id === this.selectedShapeId).map(s => s.id);

    if (ids.length < 2) return;

    const idSet = new Set(ids);
    const toGroup: ShapeData[] = [];
    const remaining: ShapeData[] = [];
    let insertIdx = -1;

    for (let i = 0; i < this.shapes.length; i++) {
      if (idSet.has(this.shapes[i].id)) {
        if (insertIdx === -1) insertIdx = remaining.length;
        toGroup.push(this.shapes[i]);
      } else {
        remaining.push(this.shapes[i]);
      }
    }

    if (toGroup.length < 2) return;


    const gEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const groupId = this.nextId();
    gEl.id = groupId;
    const groupName = `Group ${groupId.replace('shape-', '#')}`;
    gEl.setAttribute('data-name', groupName);

    // Move shape elements into the group
    for (const s of toGroup) {
      gEl.appendChild(s.element);
      s.parentId = groupId;
    }

    // Insert group element into drawing layer at the right position
    const insertBefore = remaining[insertIdx]?.element ?? null;
    if (insertBefore) {
      this.drawingLayer.insertBefore(gEl, insertBefore);
    } else {
      this.drawingLayer.appendChild(gEl);
    }

    const groupShape: ShapeData = {
      id: groupId,
      type: 'group',
      element: gEl,
      name: groupName,
      style: { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1 },
      visible: true,
      locked: false,
      children: toGroup,
    };

    remaining.splice(insertIdx, 0, groupShape);
    this.shapes = remaining;
    this.selectedShapeIds = [groupId];
    this.saveHistory();
    this.onChangeCallback();
  }

  /** Create a new empty group ("layer") at the top of the stack. */
  addEmptyGroup(): void {
    const gEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const id = this.nextId();
    gEl.id = id;
    const name = `Layer ${id.replace('shape-', '#')}`;
    gEl.setAttribute('data-name', name);
    this.drawingLayer.appendChild(gEl);

    this.shapes.push({
      id,
      type: 'group',
      element: gEl,
      name,
      style: { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1 },
      visible: true,
      locked: false,
      children: [],
    });
    this.selectedShapeIds = [id];
    this.saveHistory();
    this.onChangeCallback();
  }

  ungroupShape(id: string): void {
    const idx = this.shapes.findIndex(s => s.id === id);
    if (idx === -1) return;
    const group = this.shapes[idx];
    if (group.type !== 'group' || !group.children) return;

    // Move children out of the group element back to drawing layer
    const gEl = group.element;
    const nextSibling = gEl.nextSibling;
    const children = [...group.children];

    for (const child of children) {
      child.parentId = undefined;
      if (nextSibling) {
        this.drawingLayer.insertBefore(child.element, nextSibling);
      } else {
        this.drawingLayer.appendChild(child.element);
      }
    }

    // Remove the group element
    gEl.remove();

    // Replace group in shapes array with its children
    this.shapes.splice(idx, 1, ...children);
    this.selectedShapeIds = children.map(c => c.id);
    this.clearStaleIsolation();
    this.saveHistory();
    this.onChangeCallback();
  }

  // ---- Boolean / Pathfinder (live compound shapes) ----

  /**
   * Combine the current top-level selection with a Pathfinder op. The four
   * single-output ops build a LIVE `<g data-boolean>` whose operands stay
   * editable (double-click to enter isolation) and whose cached result path
   * recomputes on edit. `divide` produces a plain group of the disjoint pieces.
   * Operands are taken in document order (bottom→top z), which defines subtract.
   * Returns false (no-op) when fewer than two shapes are selected or the result
   * is empty (e.g. intersecting disjoint shapes).
   */
  async booleanSelection(op: BooleanOp, reverse = false): Promise<boolean> {
    const idSet = new Set(this.selectedShapeIds);
    const operands: ShapeData[] = [];
    const remaining: ShapeData[] = [];
    let insertIdx = -1;
    for (const s of this.shapes) {
      if (idSet.has(s.id)) {
        if (insertIdx === -1) insertIdx = remaining.length;
        operands.push(s);
      } else {
        remaining.push(s);
      }
    }
    if (operands.length < 2) return false;
    if (reverse) operands.reverse(); // Subtract "swap": flip which shape is the cutter.

    await ensureBooleanEngine();

    const operandDs = this.operandDsInLayerSpace(operands);
    if (!operandDs) return false;
    const resultDs = computeBoolean(operandDs, op);
    if (resultDs.length === 0 || resultDs.every((d) => !d.trim())) return false;

    const insertBefore = remaining[insertIdx]?.element ?? null;
    const newShape = op === 'divide'
      ? this.buildDivideGroup(operands, resultDs, insertBefore)
      : this.buildBooleanShape(op, operands, resultDs[0], insertBefore);

    remaining.splice(insertIdx < 0 ? remaining.length : insertIdx, 0, newShape);
    this.shapes = remaining;
    this.selectedShapeIds = [newShape.id];
    this.saveHistory();
    this.onChangeCallback();
    return true;
  }

  /** Operand geometry as `d` strings in drawing-layer space (the common space the
   *  result lives in). Returns null if the layer isn't currently rendered. */
  private operandDsInLayerSpace(operands: ShapeData[]): string[] | null {
    const layerCtm = this.drawingLayer.getScreenCTM();
    if (!layerCtm) return null;
    const layerInv = layerCtm.inverse();
    return operands.map((s) => {
      const ctm = (s.element as unknown as SVGGraphicsElement).getScreenCTM();
      return ctm ? elementPathData(s.element, layerInv.multiply(ctm)) : '';
    });
  }

  /**
   * Non-mutating preview of a boolean over the current selection, in drawing-layer
   * space — used by the Pathfinder panel to ghost the result on hover. Synchronous;
   * returns [] if the engine isn't loaded yet or fewer than two shapes are selected.
   */
  previewSelectionBoolean(op: BooleanOp, reverse = false): string[] {
    if (!booleanEngineReady()) return [];
    const operands = this.shapes.filter((s) => this.selectedShapeIds.includes(s.id));
    if (operands.length < 2) return [];
    if (reverse) operands.reverse();
    const operandDs = this.operandDsInLayerSpace(operands);
    if (!operandDs) return [];
    return computeBoolean(operandDs, op);
  }

  /** Assemble the live `<g data-boolean>` wrapper from operand shapes. */
  private buildBooleanShape(
    op: BooleanOp, operands: ShapeData[], resultD: string, insertBefore: SVGElement | null,
  ): ShapeData {
    const SVG = 'http://www.w3.org/2000/svg';
    const gEl = document.createElementNS(SVG, 'g');
    const id = this.nextId();
    gEl.id = id;
    const name = `${op[0].toUpperCase()}${op.slice(1)} ${id.replace('shape-', '#')}`;
    gEl.setAttribute('data-name', name);
    gEl.setAttribute('data-boolean', op);
    gEl.setAttribute('fill-rule', 'evenodd');
    // Result paint comes from the wrapper, seeded from the bottom operand.
    const base = operands[0].element;
    for (const attr of ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity']) {
      const v = base.getAttribute(attr);
      if (v != null) gEl.setAttribute(attr, v);
    }

    // Move operand elements in (bottom→top), tagging them as the editable source.
    for (const s of operands) {
      s.element.setAttribute('data-bool-operand', '');
      gEl.appendChild(s.element);
      s.parentId = id;
    }
    // Cached result path renders on top and inherits the wrapper's paint.
    const resultEl = document.createElementNS(SVG, 'path');
    resultEl.setAttribute('data-bool-result', '');
    resultEl.setAttribute('d', resultD);
    gEl.appendChild(resultEl);

    if (insertBefore) this.drawingLayer.insertBefore(gEl, insertBefore);
    else this.drawingLayer.appendChild(gEl);

    return {
      id, type: 'boolean', element: gEl, name,
      style: this.readStyle(gEl, 'boolean'),
      visible: true, locked: false,
      booleanOp: op as ShapeData['booleanOp'],
      children: operands,
    };
  }

  /** Divide: replace operands with a plain group of the disjoint region paths. */
  private buildDivideGroup(
    operands: ShapeData[], pieceDs: string[], insertBefore: SVGElement | null,
  ): ShapeData {
    const SVG = 'http://www.w3.org/2000/svg';
    const gEl = document.createElementNS(SVG, 'g');
    const id = this.nextId();
    gEl.id = id;
    const name = `Divide ${id.replace('shape-', '#')}`;
    gEl.setAttribute('data-name', name);
    const fill = operands[0].element.getAttribute('fill') ?? '#cccccc';

    const children: ShapeData[] = [];
    for (const d of pieceDs) {
      if (!d.trim()) continue;
      const pEl = document.createElementNS(SVG, 'path');
      const pid = this.nextId();
      pEl.id = pid;
      pEl.setAttribute('d', d);
      pEl.setAttribute('fill', fill);
      pEl.setAttribute('fill-rule', 'evenodd');
      pEl.setAttribute('data-name', `Piece ${pid.replace('shape-', '#')}`);
      gEl.appendChild(pEl);
      children.push({
        id: pid, type: 'path', element: pEl, name: `Piece ${pid.replace('shape-', '#')}`,
        style: this.readStyle(pEl, 'path'), visible: true, locked: false, parentId: id,
      });
    }
    // The originals are consumed by Divide.
    for (const s of operands) s.element.remove();

    if (insertBefore) this.drawingLayer.insertBefore(gEl, insertBefore);
    else this.drawingLayer.appendChild(gEl);

    return {
      id, type: 'group', element: gEl, name,
      style: { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1 },
      visible: true, locked: false, children,
    };
  }

  /**
   * Regenerate a live boolean's cached result path from its current operands.
   * Operands are read in the wrapper's local space, so any per-operand or
   * ancestor transform is handled uniformly. No-op if the engine isn't loaded
   * or operands aren't currently rendered (so it never clobbers with stale data).
   */
  recomputeBoolean(wrapperEl: SVGElement): void {
    if (!booleanEngineReady()) return;
    const op = (wrapperEl.getAttribute('data-boolean') as BooleanOp) || 'unite';
    const wrapperCtm = (wrapperEl as unknown as SVGGraphicsElement).getScreenCTM();
    if (!wrapperCtm) return;
    const wInv = wrapperCtm.inverse();
    const operandDs: string[] = [];
    let resultEl: SVGElement | null = null;
    for (const child of Array.from(wrapperEl.children)) {
      const el = child as SVGElement;
      if (el.hasAttribute('data-bool-result')) { resultEl = el; continue; }
      if (!el.hasAttribute('data-bool-operand')) continue;
      const ctm = (el as unknown as SVGGraphicsElement).getScreenCTM();
      if (!ctm) return; // an operand isn't rendered → abort rather than clobber
      operandDs.push(elementPathData(el, wInv.multiply(ctm)));
    }
    if (!resultEl || operandDs.length < 2) return;
    const out = computeBoolean(operandDs, op);
    if (out[0]) resultEl.setAttribute('d', out[0]);
  }

  /** Commit a live boolean to a plain editable `<path>`, discarding operands. */
  flattenBoolean(id: string): void {
    const shape = this.findShapeById(id);
    if (!shape || shape.type !== 'boolean') return;
    const wrapper = shape.element;
    if (booleanEngineReady()) this.recomputeBoolean(wrapper);
    const result = wrapper.querySelector('[data-bool-result]');
    const d = result?.getAttribute('d') ?? '';
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.id = id;
    path.setAttribute('d', d);
    for (const attr of ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-rule', 'fill-opacity', 'stroke-opacity', 'data-name']) {
      const v = wrapper.getAttribute(attr);
      if (v != null) path.setAttribute(attr, v);
    }
    this.exitGroupIsolation();
    wrapper.replaceWith(path);
    this.rebuildShapesFromDOM();
    this.selectedShapeIds = [id];
    this.saveHistory();
    this.onChangeCallback();
  }

  /** True if `shape` is a direct operand of a live boolean wrapper. */
  private isBooleanOperand(shape: ShapeData): boolean {
    return shape.element.hasAttribute('data-bool-operand') &&
      this.findShapeById(shape.parentId ?? '')?.type === 'boolean';
  }

  /**
   * Replace a primitive operand element with an equivalent `<path>` in place,
   * preserving id, paint, transform, and operand tagging, then re-sync the model
   * so node editing can proceed. Geometry is exact (its local d, transform kept).
   */
  private convertOperandToPath(shape: ShapeData): boolean {
    const el = shape.element;
    const d = localPathData(el);
    if (!d.trim()) return false;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    // Carry over everything except the primitive's geometry attributes.
    const geomAttrs = new Set(['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'x1', 'y1', 'x2', 'y2']);
    for (const a of Array.from(el.attributes)) {
      if (!geomAttrs.has(a.name)) path.setAttribute(a.name, a.value);
    }
    path.setAttribute('d', d);
    el.replaceWith(path);
    shape.element = path;
    shape.type = 'path';
    return true;
  }

  private ensureDefs(): SVGDefsElement {
    if (this.defsElement) return this.defsElement;
    const svgCanvas = this.drawingLayer.closest('svg');
    if (!svgCanvas) throw new Error('No SVG parent found');
    let defs = svgCanvas.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svgCanvas.insertBefore(defs, svgCanvas.firstChild);
    }
    this.defsElement = defs as SVGDefsElement;
    return this.defsElement;
  }

  private nextSymbolId(): string {
    return `symbol-${++this.symbolCounter}`;
  }

  createSymbolFromShape(shapeId: string): SymbolDef | null {
    const idx = this.shapes.findIndex(s => s.id === shapeId);
    if (idx === -1) return null;
    const shape = this.shapes[idx];

    const defs = this.ensureDefs();
    const symbolEl = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
    const symId = this.nextSymbolId();
    symbolEl.id = symId;

    // Get bounding box for viewBox
    const bbox = (shape.element as unknown as SVGGraphicsElement).getBBox();
    symbolEl.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);


    const clone = shape.element.cloneNode(true) as SVGElement;
    clone.removeAttribute('id');
    symbolEl.appendChild(clone);
    defs.appendChild(symbolEl);

    const symName = shape.name || `Symbol ${symId}`;
    const symbolDef: SymbolDef = { id: symId, name: symName, element: symbolEl as unknown as SVGSymbolElement };
    this.symbols.push(symbolDef);


    const useEl = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    const useId = this.nextId();
    useEl.id = useId;
    useEl.setAttribute('href', `#${symId}`);
    useEl.setAttribute('x', String(bbox.x));
    useEl.setAttribute('y', String(bbox.y));
    useEl.setAttribute('width', String(bbox.width));
    useEl.setAttribute('height', String(bbox.height));
    useEl.setAttribute('data-name', `${symName} instance`);

    // Replace in DOM
    shape.element.replaceWith(useEl);

    // Replace in shapes array
    this.shapes[idx] = {
      id: useId,
      type: 'use',
      element: useEl,
      name: `${symName} instance`,
      style: { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: parseFloat(shape.element.getAttribute('opacity') ?? '1') },
      visible: true,
      locked: false,
      symbolId: symId,
    };

    this.selectedShapeIds = [useId];
    this.saveHistory();
    this.onChangeCallback();
    return symbolDef;
  }

  placeSymbolInstance(symId: string): void {
    const sym = this.symbols.find(s => s.id === symId);
    if (!sym) return;

    const viewBox = sym.element.getAttribute('viewBox')?.split(' ').map(Number) ?? [0, 0, 100, 100];
    const ab = this.getActiveArtboard();
    const w = viewBox[2];
    const h = viewBox[3];
    const x = ab.x + (ab.width - w) / 2;
    const y = ab.y + (ab.height - h) / 2;

    const useEl = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    const id = this.nextId();
    useEl.id = id;
    useEl.setAttribute('href', `#${symId}`);
    useEl.setAttribute('x', String(x));
    useEl.setAttribute('y', String(y));
    useEl.setAttribute('width', String(w));
    useEl.setAttribute('height', String(h));
    const name = `${sym.name} instance`;
    useEl.setAttribute('data-name', name);

    this.addShape({
      id, type: 'use', element: useEl, name,
      style: { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1 },
      visible: true, locked: false,
      symbolId: symId,
    });
  }

  detachSymbolInstance(shapeId: string): void {
    const idx = this.shapes.findIndex(s => s.id === shapeId);
    if (idx === -1) return;
    const shape = this.shapes[idx];
    if (shape.type !== 'use' || !shape.symbolId) return;

    const sym = this.symbols.find(s => s.id === shape.symbolId);
    if (!sym) return;

    // Get position/size of the use element
    const useEl = shape.element;
    const x = parseFloat(useEl.getAttribute('x') ?? '0');
    const y = parseFloat(useEl.getAttribute('y') ?? '0');
    const w = parseFloat(useEl.getAttribute('width') ?? '100');
    const h = parseFloat(useEl.getAttribute('height') ?? '100');

    // Clone the symbol content
    const symbolContent = sym.element.firstElementChild;
    if (!symbolContent) return;

    const clone = document.importNode(symbolContent, true) as SVGElement;
    const newId = this.nextId();
    clone.id = newId;
    const type = this.detectType(clone);
    if (!type) return;

    // Position the clone to match the use element placement
    const viewBox = sym.element.getAttribute('viewBox')?.split(' ').map(Number) ?? [0, 0, w, h];
    const scaleX = w / viewBox[2];
    const scaleY = h / viewBox[3];
    if (scaleX !== 1 || scaleY !== 1 || x !== viewBox[0] || y !== viewBox[1]) {
      const tx = x - viewBox[0] * scaleX;
      const ty = y - viewBox[1] * scaleY;
      clone.setAttribute('transform', `translate(${tx}, ${ty}) scale(${scaleX}, ${scaleY})`);
    }

    const name = `${type} ${newId.replace('shape-', '#')}`;
    clone.setAttribute('data-name', name);

    // Replace in DOM
    useEl.replaceWith(clone);

    // Replace in shapes array
    this.shapes[idx] = {
      id: newId, type, element: clone, name,
      style: this.readStyle(clone, type),
      visible: true, locked: false,
    };

    this.selectedShapeIds = [newId];
    this.saveHistory();
    this.onChangeCallback();
  }

  /** Remove a symbol definition (existing instances will no longer resolve). */
  removeSymbol(id: string): void {
    const idx = this.symbols.findIndex(s => s.id === id);
    if (idx === -1) return;
    this.symbols[idx].element.remove();
    this.symbols.splice(idx, 1);
    if (this.selectedSymbolId === id) this.selectedSymbolId = null;
    this.onChangeCallback();
  }

  // ---- Gradient management ----

  createGradient(type: 'linear' | 'radial', stops?: GradientStop[]): GradientDef {
    const id = `grad-${++this.gradCounter}`;
    const defaultStops: GradientStop[] = stops ?? [
      { offset: 0, color: '#000000', opacity: 1 },
      { offset: 1, color: '#FFFFFF', opacity: 1 },
    ];
    const grad: GradientDef = {
      id, type, stops: defaultStops,
      spreadMethod: 'pad',
      ...(type === 'linear'
        ? { x1: 0, y1: 0, x2: 1, y2: 0 }
        : { cx: 0.5, cy: 0.5, r: 0.5, fx: 0.5, fy: 0.5 }),
    };
    this.gradients.push(grad);
    this.syncGradientToDefs(grad);
    return grad;
  }

  updateGradient(grad: GradientDef): void {
    const idx = this.gradients.findIndex(g => g.id === grad.id);
    if (idx >= 0) this.gradients[idx] = grad;
    this.syncGradientToDefs(grad);
    this.onChangeCallback();
  }

  removeGradient(id: string): void {
    this.gradients = this.gradients.filter(g => g.id !== id);
    const defs = this.ensureDefs();
    const el = defs.querySelector(`#${id}`);
    if (el) el.remove();
  }

  getGradientById(id: string): GradientDef | undefined {
    return this.gradients.find(g => g.id === id);
  }

  private syncGradientToDefs(grad: GradientDef): void {
    const defs = this.ensureDefs();
    const NS = 'http://www.w3.org/2000/svg';

    // Remove existing
    const existing = defs.querySelector(`#${grad.id}`);
    if (existing) existing.remove();

    const el = document.createElementNS(NS,
      grad.type === 'linear' ? 'linearGradient' : 'radialGradient');
    el.id = grad.id;

    if (grad.type === 'linear') {
      el.setAttribute('x1', String(grad.x1 ?? 0));
      el.setAttribute('y1', String(grad.y1 ?? 0));
      el.setAttribute('x2', String(grad.x2 ?? 1));
      el.setAttribute('y2', String(grad.y2 ?? 0));
    } else {
      el.setAttribute('cx', String(grad.cx ?? 0.5));
      el.setAttribute('cy', String(grad.cy ?? 0.5));
      el.setAttribute('r', String(grad.r ?? 0.5));
      el.setAttribute('fx', String(grad.fx ?? 0.5));
      el.setAttribute('fy', String(grad.fy ?? 0.5));
    }
    el.setAttribute('spreadMethod', grad.spreadMethod ?? 'pad');

    for (const stop of grad.stops) {
      const s = document.createElementNS(NS, 'stop');
      s.setAttribute('offset', String(stop.offset));
      s.setAttribute('stop-color', stop.color);
      if (stop.opacity < 1) s.setAttribute('stop-opacity', String(stop.opacity));
      el.appendChild(s);
    }

    defs.appendChild(el);
  }

  // ---- Pattern management ----

  createPattern(def: Partial<PatternDef> & { type: PatternDef['type'] }): PatternDef {
    const id = `pat-${++this.patternCounter}`;
    const pat: PatternDef = {
      id, type: def.type,
      preset: def.preset,
      presetColor: def.presetColor ?? '#000000',
      imageDataUrl: def.imageDataUrl,
      scale: def.scale ?? 1,
      rotation: def.rotation ?? 0,
      spacing: def.spacing ?? 0,
      tileWidth: def.tileWidth ?? 20,
      tileHeight: def.tileHeight ?? 20,
    };
    this.patterns.push(pat);
    this.syncPatternToDefs(pat);
    return pat;
  }

  updatePattern(pat: PatternDef): void {
    const idx = this.patterns.findIndex(p => p.id === pat.id);
    if (idx >= 0) this.patterns[idx] = pat;
    this.syncPatternToDefs(pat);
    this.onChangeCallback();
  }

  removePattern(id: string): void {
    this.patterns = this.patterns.filter(p => p.id !== id);
    const defs = this.ensureDefs();
    const el = defs.querySelector(`#${id}`);
    if (el) el.remove();
  }

  getPatternById(id: string): PatternDef | undefined {
    return this.patterns.find(p => p.id === id);
  }

  private syncPatternToDefs(pat: PatternDef): void {
    const defs = this.ensureDefs();
    const NS = 'http://www.w3.org/2000/svg';

    const existing = defs.querySelector(`#${pat.id}`);
    if (existing) existing.remove();

    const tw = pat.tileWidth * pat.scale + pat.spacing;
    const th = pat.tileHeight * pat.scale + pat.spacing;

    const el = document.createElementNS(NS, 'pattern');
    el.id = pat.id;
    el.setAttribute('width', String(tw));
    el.setAttribute('height', String(th));
    el.setAttribute('patternUnits', 'userSpaceOnUse');

    if (pat.rotation !== 0) {
      el.setAttribute('patternTransform', `rotate(${pat.rotation})`);
    }

    if (pat.type === 'image' && pat.imageDataUrl) {
      const img = document.createElementNS(NS, 'image');
      img.setAttribute('href', pat.imageDataUrl);
      img.setAttribute('width', String(pat.tileWidth * pat.scale));
      img.setAttribute('height', String(pat.tileHeight * pat.scale));
      img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      el.appendChild(img);
    } else if (pat.type === 'preset') {
      this.buildPresetPatternContent(el, pat);
    }

    defs.appendChild(el);
  }

  private buildPresetPatternContent(el: SVGPatternElement, pat: PatternDef): void {
    const tw = pat.tileWidth * pat.scale + pat.spacing;
    const th = pat.tileHeight * pat.scale + pat.spacing;
    const NS = 'http://www.w3.org/2000/svg';
    const color = pat.presetColor ?? '#000000';
    const s = pat.scale;

    switch (pat.preset) {
      case 'dots': {
        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('cx', String(tw / 2));
        dot.setAttribute('cy', String(th / 2));
        dot.setAttribute('r', String(2 * s));
        dot.setAttribute('fill', color);
        el.appendChild(dot);
        break;
      }
      case 'stripes': {
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', '0'); line.setAttribute('y1', '0');
        line.setAttribute('x2', '0'); line.setAttribute('y2', String(th));
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', String(Math.max(1, 2 * s)));
        el.appendChild(line);
        break;
      }
      case 'crosshatch': {
        const l1 = document.createElementNS(NS, 'line');
        l1.setAttribute('x1', '0'); l1.setAttribute('y1', '0');
        l1.setAttribute('x2', String(tw)); l1.setAttribute('y2', String(th));
        l1.setAttribute('stroke', color); l1.setAttribute('stroke-width', String(Math.max(0.5, s)));
        el.appendChild(l1);
        const l2 = document.createElementNS(NS, 'line');
        l2.setAttribute('x1', String(tw)); l2.setAttribute('y1', '0');
        l2.setAttribute('x2', '0'); l2.setAttribute('y2', String(th));
        l2.setAttribute('stroke', color); l2.setAttribute('stroke-width', String(Math.max(0.5, s)));
        el.appendChild(l2);
        break;
      }
      case 'grid': {
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', `M ${tw} 0 L 0 0 0 ${th}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', String(Math.max(0.5, s)));
        el.appendChild(path);
        break;
      }
    }
  }

  // ---- Defs export ----

  getDefsContent(): string {
    const parts: string[] = [];
    for (const s of this.symbols) parts.push(s.element.outerHTML);
    const defs = this.defsElement;
    if (defs) {
      // Export every def the document depends on (gradients, patterns, filters,
      // clipPaths, masks, markers, referenced templates, …) so the saved file
      // renders identically anywhere. Two exclusions: the editor's own grid /
      // transparency chrome, and <symbol>s (already emitted from this.symbols
      // above — they share these same DOM nodes, so re-emitting would duplicate).
      for (const child of Array.from(defs.children)) {
        if (EDITOR_DEF_IDS.has(child.id)) continue;
        if (child.tagName.toLowerCase() === 'symbol') continue;
        parts.push(child.outerHTML);
      }
    }
    return parts.join('\n');
  }

  getDefsBlock(): string {
    const content = this.getDefsContent();
    return content ? `<defs>${content}</defs>\n` : '';
  }

  getDrawingLayerSVG(): string {
    return this.drawingLayer.innerHTML;
  }

  /** Like {@link getDrawingLayerSVG} but with live-boolean operands stripped, so
   *  exported files contain only the computed result paths (no hidden source
   *  geometry). Save/load uses the raw form above to keep booleans editable. */
  getDrawingLayerSVGForExport(): string {
    if (!this.drawingLayer.querySelector('[data-boolean]')) return this.drawingLayer.innerHTML;
    const clone = this.drawingLayer.cloneNode(true) as SVGGElement;
    stripBooleanOperands(clone);
    return clone.innerHTML;
  }

  clearAll(): void {
    this.shapeById.clear();
    this.drawingLayer.innerHTML = '';
    this.shapes = [];
    this.selectedShapeIds = [];
    this.clearDefs();
    this.selectedSymbolId = null;
    this.artboards = [{
      id: this.nextArtboardId(),
      x: 0, y: 0, width: 960, height: 540, name: 'Artboard 1',
    }];
    this.activeArtboardId = this.artboards[0].id;
    this.selectedArtboardId = null;
    this.saveHistory();
    this.onChangeCallback();
  }

  /** Public wrapper: import gradients/patterns/symbols from a parsed SVG element. */
  importDefsFrom(svgEl: Element): void {
    this.importDefsFromSVG(svgEl);
  }

  /** Clear all symbols/gradients/patterns and empty the live <defs>. */
  clearDefs(): void {
    this.symbols = [];
    this.gradients = [];
    this.patterns = [];
    this.symbolCounter = 0;
    this.gradCounter = 0;
    this.patternCounter = 0;
    // Remove imported/user defs but keep the editor's grid & transparency
    // patterns, which live in this same <defs> and back the canvas chrome.
    if (this.defsElement) {
      for (const child of Array.from(this.defsElement.children)) {
        if (!EDITOR_DEF_IDS.has(child.id)) child.remove();
      }
    }
  }

  private importDefsFromSVG(svgEl: Element): void {
    const defsEl = svgEl.querySelector('defs');
    if (!defsEl) return;

    for (const child of Array.from(defsEl.children)) {
      // Skip the editor's own grid/transparency chrome — the canvas already
      // has it, so re-importing would duplicate it (and leak it on re-export).
      if (EDITOR_DEF_IDS.has(child.id)) continue;
      const tag = child.tagName.toLowerCase();

      // Gradients and patterns get a tracked model (they're surfaced in the
      // editor UI). Every other def type — filters, clipPaths, masks, markers,
      // symbols, referenced template geometry — is copied verbatim below so the
      // `url(#…)` / `xlink:href` references in the artwork resolve. Without this,
      // layered SVGs (e.g. Inkscape glow/halo strokes built from <use> + filter)
      // lose their entire appearance.
      if (tag !== 'lineargradient' && tag !== 'radialgradient' && tag !== 'pattern') {
        const imported = document.importNode(child, true) as SVGElement;
        sanitizeSvgElement(imported);
        this.ensureDefs().appendChild(imported);
        // Track symbols so they appear in the Symbols panel and round-trip.
        if (tag === 'symbol') {
          const id = imported.id || `symbol-${++this.symbolCounter}`;
          imported.id = id;
          const m = id.match(/symbol-(\d+)/);
          if (m) this.symbolCounter = Math.max(this.symbolCounter, parseInt(m[1]));
          this.symbols.push({
            id,
            name: imported.getAttribute('data-name') || `Symbol ${id}`,
            element: imported as unknown as SVGSymbolElement,
          });
        }
        continue;
      }

      if (tag === 'lineargradient' || tag === 'radialgradient') {
        const type = tag === 'lineargradient' ? 'linear' as const : 'radial' as const;
        const id = child.id || `grad-${++this.gradCounter}`;
        const stops: GradientStop[] = [];
        for (const stopEl of Array.from(child.querySelectorAll('stop'))) {
          stops.push({
            offset: parseFloat(stopEl.getAttribute('offset') ?? '0'),
            color: stopEl.getAttribute('stop-color') ?? '#000000',
            opacity: parseFloat(stopEl.getAttribute('stop-opacity') ?? '1'),
          });
        }
        const grad: GradientDef = {
          id, type, stops,
          spreadMethod: (child.getAttribute('spreadMethod') as GradientDef['spreadMethod']) ?? 'pad',
          x1: parseFloat(child.getAttribute('x1') ?? '0'),
          y1: parseFloat(child.getAttribute('y1') ?? '0'),
          x2: parseFloat(child.getAttribute('x2') ?? '1'),
          y2: parseFloat(child.getAttribute('y2') ?? '0'),
          cx: parseFloat(child.getAttribute('cx') ?? '0.5'),
          cy: parseFloat(child.getAttribute('cy') ?? '0.5'),
          r: parseFloat(child.getAttribute('r') ?? '0.5'),
          fx: parseFloat(child.getAttribute('fx') ?? '0.5'),
          fy: parseFloat(child.getAttribute('fy') ?? '0.5'),
        };
        this.gradients.push(grad);

        // Ensure counter stays ahead
        const m = id.match(/grad-(\d+)/);
        if (m) this.gradCounter = Math.max(this.gradCounter, parseInt(m[1]));

        // Copy element into our defs
        const imported = document.importNode(child, true) as SVGElement;
        sanitizeSvgElement(imported);
        this.ensureDefs().appendChild(imported);
      }

      if (tag === 'pattern') {
        const id = child.id || `pat-${++this.patternCounter}`;
        const m = id.match(/pat-(\d+)/);
        if (m) this.patternCounter = Math.max(this.patternCounter, parseInt(m[1]));

        // Copy element into our defs (sanitized: patterns can embed <image href>)
        const imported = document.importNode(child, true) as SVGElement;
        sanitizeSvgElement(imported);
        this.ensureDefs().appendChild(imported);

        // Create a minimal PatternDef for tracking
        this.patterns.push({
          id, type: 'preset', preset: 'grid',
          presetColor: '#000000',
          scale: 1, rotation: 0, spacing: 0,
          tileWidth: parseFloat(child.getAttribute('width') ?? '20'),
          tileHeight: parseFloat(child.getAttribute('height') ?? '20'),
        });
      }
    }
  }

  /**
   * Import a foreign SVG so it renders byte-for-byte the way a browser would.
   *
   * Rather than reconstruct the artwork from a whitelist of tags (which dropped
   * `<use>`, filters, clipPaths, masks, markers, … and rewrote every id, breaking
   * the internal `#…` references that drive layered Inkscape/Illustrator output),
   * we faithfully clone the whole tree: every rendering element, every `<defs>`
   * entry, and every original id are preserved so `url(#…)` / `xlink:href` refs
   * still resolve. The editor model is then derived from the live DOM by
   * {@link rebuildShapesFromDOM}, which already understands use/group/path/text/…;
   * anything it doesn't model still renders, because the node stays in the DOM.
   */
  importSVGContent(svgString: string): void {
    const doc = new DOMParser().parseFromString(ensureSvgNamespaces(svgString), 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return;
    this.drawingLayer.innerHTML = '';
    this.shapes = [];

    // 1. Bring across the full <defs> (filters, clipPaths, masks, markers,
    //    symbols, gradients, patterns, referenced templates) so every reference
    //    in the artwork resolves once the content lands in the live document.
    this.importDefsFromSVG(svgEl);

    // 2. Faithfully clone each rendering child, ids and references intact.
    //    Non-rendering containers/metadata are skipped (defs is handled above).
    const NON_RENDERING = new Set(['defs', 'metadata', 'title', 'desc', 'namedview']);
    for (const child of Array.from(svgEl.children)) {
      if (NON_RENDERING.has(child.localName.toLowerCase())) continue;
      this.drawingLayer.appendChild(document.importNode(child, true));
    }

    // 3. Security-sanitize the imported subtree in place (strips event handlers
    //    and unsafe hrefs without disturbing geometry or internal references).
    sanitizeSvgElement(this.drawingLayer);

    // 4. Strip Inkscape's degenerate subpaths (anchors collapsed to a point with
    //    control points flung to the origin) — invisible when filled but a stray
    //    line when stroked. This is the one intentional deviation from raw input.
    for (const pathEl of Array.from(this.drawingLayer.querySelectorAll('path'))) {
      const d = pathEl.getAttribute('d');
      if (!d) continue;
      const { d: clean, removed } = sanitizePathData(d);
      if (removed > 0) pathEl.setAttribute('d', clean);
    }

    // 5. Build the editor model from whatever was imported.
    this.rebuildShapesFromDOM();
    this.selectedShapeIds = [];
    this.saveHistory();
    this.onChangeCallback();
  }

  /** Load raw SVG innerHTML into the drawing layer (used by project file loader) */
  importSVGMarkup(svgMarkup: string): void {
    // Untrusted file content: sanitize before it touches the live DOM so a
    // crafted .svg/.svgmaker can't smuggle in event handlers or external refs.
    this.drawingLayer.innerHTML = sanitizeSvgMarkup(svgMarkup);
    this.rebuildShapesFromDOM();
    this.selectedShapeIds = [];
  }
}
