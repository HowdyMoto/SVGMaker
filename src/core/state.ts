import type { ToolName, ShapeData, HistoryEntry, ShapeStyle, Artboard, SymbolDef, GradientDef, GradientStop, PatternDef, ObjectShadow } from './types';
import { ensureSvgNamespaces } from './svg-ns';
import { sanitizePathData } from './path-sanitize';
import { sanitizeSvgElement, sanitizeSvgMarkup } from './svg-sanitize';
import { PathEditSession } from './path-edit';
import { History } from './history';
import { PaintRegistry } from './paint-registry';
import { ClipboardManager, type ClipboardHost } from './clipboard';
import { SymbolRegistry, type SymbolHost } from './symbol-registry';
import { nudgeTranslate, getRotation } from './transform';
import { applyStrokeAlignment, STROKE_CLIP_PREFIX } from './stroke-align';
import {
  type BooleanOp, type StrokeJoin, type StrokeCap,
  ensureBooleanEngine, booleanEngineReady, computeBoolean, elementPathData,
  stripBooleanOperands, localPathData,
  ensureOffsetEngine, offsetPathData, outlineStrokeData,
} from './boolean';

/**
 * Built-in editor chrome that lives in the canvas <defs> (the grid background
 * and transparency checkerboard). It must never be exported or re-imported:
 * their tiny corner paths render as stray lines in tools that read raw <path>
 * geometry and ignore <defs>/<pattern> structure (e.g. TraceCraft).
 */
const EDITOR_DEF_IDS = new Set(['grid-small', 'grid-large', 'transparency-check']);

/**
 * Above this many rendered elements, a document is treated as a bulk/generative
 * import: rebuildShapesFromDOM stops auto-assigning ids to id-less elements
 * (which would model each as its own Layers-panel row). Normal artwork is far
 * below this; it only excludes pathological files (e.g. a 21MB attractor with
 * 100k segments) where per-element layers are useless and prohibitively slow.
 */
const AUTO_ID_MODEL_LIMIT = 20000;

/**
 * Paint/style properties promoted from an inline `style` attribute to the
 * equivalent presentation attribute on import, so the editor's attribute-based
 * model can read and write them. See {@link AppState.flattenInlineStyle}.
 */
const FLATTEN_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity',
  'font-size', 'font-family', 'font-weight', 'font-style', 'rx',
];

/**
 * `innerHTML`/`outerHTML` use HTML fragment serialization, which emits `&nbsp;`
 * for a U+00A0 non-breaking space. That entity is undefined in XML/SVG, so the
 * markup fails to re-parse — breaking save→reload, export, and undo/redo (history
 * restore re-parses as XML and would silently drop the content). Map it to the
 * numeric reference, which is valid in both. `&nbsp;` is the only non-XML entity
 * these serializers produce, and a literal "&nbsp;" in text serializes as
 * "&amp;nbsp;", so this never corrupts real content.
 */
function xmlSafeMarkup(html: string): string {
  return html.replace(/&nbsp;/g, '&#160;');
}

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
  /** Undo/redo stack. Owns the index/branching/cap bookkeeping; this class
   *  supplies the document capture/restore via {@link captureSnapshot} /
   *  {@link restoreHistory}. See core/history.ts. */
  private historyMgr: History;
  // Step-and-repeat: the offset the next ⌘D applies, and the ids of the most
  // recent duplicate (so moving exactly that copy refines the offset).
  private stepOffset: { dx: number; dy: number } | null = null;
  private lastDuplicateIds: string[] = [];
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

  /** Set by the last importSVGContent: the source contained SMIL animation
   *  (<animate>, <animateTransform>, …), which the sanitizer strips. Lets the UI
   *  warn that the animation was dropped and won't be saved. (CSS animation in a
   *  <style> block survives and is not flagged.) */
  lastImportHadAnimation = false;

  /**
   * When true, "Export Active Artboard" bakes element transforms into geometry
   * so the SVG contains no transform attributes (for consumers that ignore
   * them, e.g. TraceCraft). Persisted across sessions; on by default.
   */
  bakeTransformsOnExport = (() => {
    try { return localStorage.getItem('svgmaker.bakeTransforms') !== 'false'; } catch { return true; }
  })();

  /** <symbol> defs + the shape↔<use> transforms. Extracted to
   *  core/symbol-registry.ts. `symbols` is a read-only view for the panel and
   *  export; all mutation goes through the registry. */
  private symbolRegistry: SymbolRegistry;
  get symbols(): SymbolDef[] { return this.symbolRegistry.symbols; }
  private defsElement: SVGDefsElement | null = null;

  /** Gradients & patterns: tracked models + their live <defs> elements.
   *  Extracted to core/paint-registry.ts; AppState delegates the public paint
   *  methods to it and reaches it for clear/import. */
  private paint: PaintRegistry;

  /** Cut/copy/paste. Extracted to core/clipboard.ts; reaches the shape model
   *  through the host adapter built in the constructor. */
  private clipboardMgr: ClipboardManager;

  /**
   * Extra `xmlns:` prefixes declared on an imported file's root (Adobe's
   * `i`/`x`/`graph`, custom `bx`, …) beyond the ones we always emit
   * (xlink/inkscape/sodipodi). Prefixed attributes/elements survive import in
   * the live DOM, so on save we must re-declare their namespaces or the file is
   * invalid XML and won't reload. Captured on import, re-emitted on serialize.
   */
  private importedNamespaces = new Map<string, string>();

  /**
   * Paint properties that some author `<style>` rule targets in the current
   * document. Flattening one of these from inline style to a presentation
   * attribute can change the cascade outcome (a stylesheet rule outranks an
   * attribute but not inline style), so {@link flattenInlineStyle} guards them.
   * Refreshed per rebuild; empty for the common no-stylesheet case (no cost).
   */
  private stylesheetPaintProps = new Set<string>();

  constructor(drawingLayer: SVGGElement, onChange: () => void) {
    this.drawingLayer = drawingLayer;
    this.onChangeCallback = onChange;
    this.historyMgr = new History(
      () => this.captureSnapshot(),
      (entry) => this.restoreHistory(entry),
    );
    this.paint = new PaintRegistry({
      ensureDefs: () => this.ensureDefs(),
      onChange: () => this.onChangeCallback(),
    });
    const clipboardHost: ClipboardHost = {
      getShapes: () => this.shapes,
      getDrawingLayer: () => this.drawingLayer,
      getSelectedShapeIds: () => this.selectedShapeIds,
      setSelection: (ids) => { this.selectedShapeIds = ids; },
      findShape: (id) => this.findShapeById(id),
      removeShape: (id) => this.removeShape(id),
      removeSelected: () => this.removeSelected(),
      nextId: () => this.nextId(),
      offsetElement: (el, dx, dy) => this.offsetElement(el, dx, dy),
      reIdGroupChildren: (el) => this.reIdGroupChildren(el),
      detectType: (el) => this.detectType(el),
      readStyle: (el, type) => this.readStyle(el, type),
      addShape: (shape) => this.addShape(shape),
      saveHistory: () => this.saveHistory(),
      onChange: () => this.onChangeCallback(),
    };
    this.clipboardMgr = new ClipboardManager(clipboardHost);
    const symbolHost: SymbolHost = {
      getShapes: () => this.shapes,
      ensureDefs: () => this.ensureDefs(),
      nextId: () => this.nextId(),
      detectType: (el) => this.detectType(el),
      readStyle: (el, type) => this.readStyle(el, type),
      getActiveArtboard: () => this.getActiveArtboard(),
      addShape: (shape) => this.addShape(shape),
      setSelection: (ids) => { this.selectedShapeIds = ids; },
      getSelectedSymbolId: () => this.selectedSymbolId,
      setSelectedSymbolId: (id) => { this.selectedSymbolId = id; },
      saveHistory: () => this.saveHistory(),
      onChange: () => this.onChangeCallback(),
    };
    this.symbolRegistry = new SymbolRegistry(symbolHost);
    // Create the default frame ("Frame 1"). Frames are real <g data-frame>
    // container-shapes in the drawing layer; rebuildShapesFromDOM derives the
    // artboards cache from them.
    this.drawingLayer.appendChild(this.createFrameElement(0, 0, 960, 540, 'Frame 1'));
    this.rebuildShapesFromDOM();
    this.activeArtboardId = this.artboards[0]?.id ?? null;
    this.saveHistory();
    this.markClean();
  }

  // ---- Frames (Figma-style containers; the artboards cache derives from them) ----
  //
  // A frame is a `<g data-frame>` container-shape in #drawing-layer with an inline
  // <clipPath> + .frame-bg rect + children in frame-local coords. `this.artboards`
  // is a DERIVED cache (Artboard views: id/x/y/w/h/name) kept in sync by
  // syncArtboardsCache() so all the read-only callers (rulers/export/snapping/
  // status bar/align) keep working unchanged.

  private createFrameElement(x: number, y: number, w: number, h: number, name: string): SVGGElement {
    const SVG = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(SVG, 'g');
    const id = this.nextId();
    g.id = id;
    g.setAttribute('data-frame', '');
    g.setAttribute('data-name', name);
    g.setAttribute('data-frame-w', String(w));
    g.setAttribute('data-frame-h', String(h));
    if (x !== 0 || y !== 0) g.setAttribute('transform', `translate(${x} ${y})`);
    const clipId = `frameclip-${id.replace('shape-', '')}`;
    g.setAttribute('clip-path', `url(#${clipId})`);
    const clip = document.createElementNS(SVG, 'clipPath');
    clip.setAttribute('id', clipId);
    clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
    const clipRect = document.createElementNS(SVG, 'rect');
    clipRect.setAttribute('x', '0'); clipRect.setAttribute('y', '0');
    clipRect.setAttribute('width', String(w)); clipRect.setAttribute('height', String(h));
    clip.appendChild(clipRect);
    g.appendChild(clip);
    const bg = document.createElementNS(SVG, 'rect');
    bg.setAttribute('class', 'frame-bg');
    bg.setAttribute('x', '0'); bg.setAttribute('y', '0');
    bg.setAttribute('width', String(w)); bg.setAttribute('height', String(h));
    bg.setAttribute('fill', '#ffffff');
    bg.setAttribute('pointer-events', 'none');
    g.appendChild(bg);
    return g;
  }

  /** World translate of a frame's `<g>` (its position). */
  private frameTranslate(el: SVGElement): { x: number; y: number } {
    const m = (el as unknown as SVGGraphicsElement).transform.baseVal.consolidate()?.matrix;
    return { x: m?.e ?? 0, y: m?.f ?? 0 };
  }

  private frameToArtboard(s: ShapeData): Artboard {
    const { x, y } = this.frameTranslate(s.element);
    return {
      id: s.id, x, y,
      width: parseFloat(s.element.getAttribute('data-frame-w') ?? '0'),
      height: parseFloat(s.element.getAttribute('data-frame-h') ?? '0'),
      name: s.name,
    };
  }

  /** Rebuild the derived artboards cache from the top-level frame shapes. */
  private syncArtboardsCache(): void {
    this.artboards = this.shapes.filter(s => s.type === 'frame').map(s => this.frameToArtboard(s));
    if (!this.artboards.some(a => a.id === this.activeArtboardId)) {
      this.activeArtboardId = this.artboards[0]?.id ?? null;
    }
  }

  private frameShapeById(id: string): ShapeData | undefined {
    return this.shapes.find(s => s.type === 'frame' && s.id === id);
  }

  getActiveFrame(): ShapeData | null {
    return this.frameShapeById(this.activeArtboardId ?? '')
      ?? this.shapes.find(s => s.type === 'frame') ?? null;
  }

  /** The top-level frame whose world bounds contain (cx, cy), else null. */
  private frameAtPoint(cx: number, cy: number): ShapeData | null {
    const frames = this.shapes.filter(s => s.type === 'frame');
    for (let i = frames.length - 1; i >= 0; i--) { // topmost first
      const a = this.frameToArtboard(frames[i]);
      if (cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height) return frames[i];
    }
    return null;
  }

  // Keep the legacy getter for backward compat with align, export, etc.
  get artboard(): Artboard {
    return this.getActiveArtboard();
  }

  getActiveArtboard(): Artboard {
    return this.artboards.find(a => a.id === this.activeArtboardId)
      ?? this.artboards[0]
      // Safety net for documents with no frame yet (e.g. an old file mid-migration):
      // a default view so rulers/export/status never read `undefined`.
      ?? { id: '', x: 0, y: 0, width: 960, height: 540, name: 'Frame' };
  }

  getArtboardById(id: string): Artboard | undefined {
    return this.artboards.find(a => a.id === id);
  }

  nextArtboardId(): string {
    return `ab-${++this.abCounter}`;
  }

  /** Create a frame (world coords). Returns the new frame shape's id. */
  addFrame(x: number, y: number, w: number, h: number, name: string): string {
    const g = this.createFrameElement(x, y, w, h, name);
    this.drawingLayer.appendChild(g);
    this.rebuildShapesFromDOM();
    this.activeArtboardId = g.id;
    this.selectedShapeIds = [g.id];
    this.saveHistory();
    this.onChangeCallback();
    return g.id;
  }

  /** Back-compat: the artboard tool passes an Artboard-shaped object. */
  addArtboard(ab: Artboard): void {
    this.addFrame(ab.x, ab.y, ab.width, ab.height, ab.name);
  }

  /**
   * Migrate freshly-imported legacy content (no frames) into frame(s): for each
   * legacy board, wrap the top-level shapes whose center falls inside it into a
   * new frame (world→frame-local). No-op if the imported markup already has
   * frames (a current-format doc). Does not save history (the caller does).
   */
  migrateContentToFrames(boards: ReadonlyArray<{ x: number; y: number; width: number; height: number; name: string }>): void {
    if (this.shapes.some(s => s.type === 'frame')) return; // already frames
    const top = [...this.shapes];
    const moved = new Set<string>();
    for (const b of boards) {
      const g = this.createFrameElement(b.x, b.y, b.width, b.height, b.name);
      this.drawingLayer.appendChild(g);
      for (const sh of top) {
        if (moved.has(sh.id)) continue;
        let bbox: DOMRect;
        try { bbox = (sh.element as unknown as SVGGraphicsElement).getBBox(); } catch { continue; }
        const cx = bbox.x + bbox.width / 2, cy = bbox.y + bbox.height / 2;
        if (cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height) {
          this.offsetElement(sh.element, -b.x, -b.y);
          g.appendChild(sh.element);
          moved.add(sh.id);
        }
      }
    }
    this.rebuildShapesFromDOM();
  }

  /**
   * After a drag-move, reparent each moved shape into the frame now under its
   * center (or out to the pasteboard), converting coords between world and
   * frame-local space. Frames themselves are not reparented. Called by the Select
   * tool before it saves history.
   */
  reparentAfterMove(ids: string[]): void {
    let changed = false;
    for (const id of ids) {
      const shape = this.findShapeById(id);
      if (!shape || shape.type === 'frame') continue;
      const el = shape.element;
      const curParent = el.parentElement as SVGElement | null;
      const curFrameEl = curParent?.hasAttribute?.('data-frame') ? curParent : null;
      const curOff = curFrameEl ? this.frameTranslate(curFrameEl) : { x: 0, y: 0 };
      let bbox: DOMRect;
      try { bbox = (el as unknown as SVGGraphicsElement).getBBox(); } catch { continue; }
      const cx = curOff.x + bbox.x + bbox.width / 2;
      const cy = curOff.y + bbox.y + bbox.height / 2;
      const targetFrame = this.frameAtPoint(cx, cy);
      const targetEl: SVGElement = targetFrame ? (targetFrame.element as SVGElement) : this.drawingLayer;
      if (targetEl === curParent) continue; // unchanged
      const tOff = targetFrame ? this.frameToArtboard(targetFrame) : { x: 0, y: 0 };
      const dx = curOff.x - tOff.x, dy = curOff.y - tOff.y; // cur-local → target-local
      if (dx !== 0 || dy !== 0) this.offsetElement(el, dx, dy);
      targetEl.appendChild(el);
      changed = true;
    }
    if (changed) this.rebuildShapesFromDOM();
  }

  duplicateArtboard(id: string): void {
    const s = this.frameShapeById(id);
    if (!s) return;
    const cur = this.frameToArtboard(s);
    let maxRight = 0;
    for (const a of this.artboards) maxRight = Math.max(maxRight, a.x + a.width);
    const nx = maxRight + 40, ny = cur.y;

    const clone = s.element.cloneNode(true) as SVGElement;
    const newId = this.nextId();
    clone.id = newId;
    this.reIdGroupChildren(clone); // fresh ids for descendants (incl. the clipPath)
    const newClipId = `frameclip-${newId.replace('shape-', '')}`;
    const clip = clone.querySelector('clipPath');
    if (clip) clip.id = newClipId;
    clone.setAttribute('clip-path', `url(#${newClipId})`);
    clone.setAttribute('transform', `translate(${nx} ${ny})`);
    clone.setAttribute('data-name', `${cur.name} copy`);
    this.drawingLayer.appendChild(clone);
    this.rebuildShapesFromDOM();
    this.activeArtboardId = newId;
    this.selectedArtboardId = newId;
    this.selectedShapeIds = [newId];
    this.saveHistory();
    this.onChangeCallback();
  }

  removeArtboard(id: string): void {
    if (this.shapes.filter(s => s.type === 'frame').length <= 1) return; // keep ≥1
    if (!this.detachShape(id)) return;
    if (this.selectedArtboardId === id) this.selectedArtboardId = null;
    this.rebuildShapesFromDOM();
    this.saveHistory();
    this.onChangeCallback();
  }

  updateArtboard(id: string, updates: Partial<Omit<Artboard, 'id'>>): void {
    const s = this.frameShapeById(id);
    if (!s) return;
    const el = s.element;
    const cur = this.frameToArtboard(s);
    if (updates.name != null) { el.setAttribute('data-name', updates.name); s.name = updates.name; }
    const nx = updates.x ?? cur.x, ny = updates.y ?? cur.y;
    if (updates.x != null || updates.y != null) {
      if (nx !== 0 || ny !== 0) el.setAttribute('transform', `translate(${nx} ${ny})`);
      else el.removeAttribute('transform');
    }
    const nw = updates.width ?? cur.width, nh = updates.height ?? cur.height;
    if (updates.width != null || updates.height != null) {
      el.setAttribute('data-frame-w', String(nw));
      el.setAttribute('data-frame-h', String(nh));
      el.querySelectorAll('clipPath > rect, rect.frame-bg').forEach((r) => {
        r.setAttribute('width', String(nw));
        r.setAttribute('height', String(nh));
      });
    }
    this.syncArtboardsCache();
    this.onChangeCallback();
  }

  setActiveArtboard(id: string): void {
    this.activeArtboardId = id;
    this.onChangeCallback();
  }

  /** Shapes contained by a frame (real containment = the frame's children). */
  getShapesOnArtboard(abId: string): ShapeData[] {
    return this.frameShapeById(abId)?.children ?? [];
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
    this.drawingLayer.appendChild(shape.element);
    // Figma-style auto-parent: a shape drawn inside a frame becomes its child
    // (converted to frame-local coords). Otherwise it stays a top-level shape.
    const frame = this.frameForNewElement(shape.element);
    if (frame) {
      const a = this.frameToArtboard(frame);
      this.offsetElement(shape.element, -a.x, -a.y); // world → frame-local
      frame.element.appendChild(shape.element);
      this.rebuildShapesFromDOM(); // now nested under the frame → resync model
    } else {
      this.shapes.push(shape);
    }
    this.selectedShapeIds = [shape.id];
    this.saveHistory();
    this.onChangeCallback();
  }

  /** The frame a freshly-drawn element falls into (by its center), or null. */
  private frameForNewElement(el: SVGElement): ShapeData | null {
    let bbox: DOMRect;
    try { bbox = (el as unknown as SVGGraphicsElement).getBBox(); } catch { return null; }
    return this.frameAtPoint(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
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
    // Node editing operates on a <path>. A primitive (rect, ellipse, polygon/star,
    // line, polyline) is converted to an equivalent path in place so its defining
    // points become directly editable — matching Illustrator/Inkscape's node tools.
    let converted = false;
    if (shape.type !== 'path') {
      if (!this.convertShapeToPath(shape)) return false;
      converted = true;
    }
    const d = shape.element.getAttribute('d');
    if (!d) return false;
    this.editingPathId = id;
    this.pathEdit = new PathEditSession(d);
    this.selectedShapeIds = [id];
    // The in-place conversion changed the document, so make it an undoable step.
    if (converted) this.saveHistory();
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

  /**
   * Duplicate the selection in one undo step, Figma-style "step and repeat": the
   * copy is offset by {@link stepOffset}. After you nudge a fresh duplicate into
   * place (recorded via {@link notifyMovedSelection}), repeating ⌘D keeps applying
   * that same offset, so you build an evenly-spaced array by pressing ⌘D, move,
   * ⌘D, ⌘D, ⌘D…
   */
  duplicateSelected(): void {
    const ids = [...this.selectedShapeIds];
    if (ids.length === 0) return;
    const off = this.stepOffset ?? { dx: 10, dy: 10 };
    const newIds: string[] = [];
    for (const id of ids) {
      const newId = this.cloneShapeById(id, off.dx, off.dy);
      if (newId) newIds.push(newId);
    }
    if (newIds.length === 0) return;
    this.selectedShapeIds = newIds;
    // Remember this copy and the step, so a move of *this* copy refines the offset
    // and further ⌘D presses continue the pattern.
    this.lastDuplicateIds = [...newIds];
    this.stepOffset = off;
    this.saveHistory();
    this.onChangeCallback();
  }

  /**
   * Told by the Select tool when a drag-move finishes. If it moved exactly the
   * shapes produced by the last duplicate, that delta becomes the step-and-repeat
   * offset; any other move breaks the chain so the next ⌘D uses the default.
   */
  notifyMovedSelection(dx: number, dy: number): void {
    const moved = [...this.selectedShapeIds].sort().join(',');
    const lastDup = [...this.lastDuplicateIds].sort().join(',');
    if (lastDup && moved === lastDup && (dx !== 0 || dy !== 0)) {
      this.stepOffset = { dx, dy };
    } else {
      this.lastDuplicateIds = [];
      this.stepOffset = null;
    }
  }

  /**
   * Clone a shape into the drawing layer offset by 10px, returning the new id.
   * Does NOT record history / select / notify — callers batch those so a
   * multi-duplicate is one undo step.
   */
  private cloneShapeById(id: string, dx = 10, dy = 10): string | null {
    const shape = this.shapes.find(s => s.id === id);
    if (!shape) return null;
    const newEl = shape.element.cloneNode(true) as SVGElement;
    const newId = this.nextId();
    newEl.id = newId;
    // Re-id descendants so a duplicated group doesn't share child ids with the
    // original (which corrupts findShapeById / idCounter after a history rebuild).
    if (shape.type === 'group') this.reIdGroupChildren(newEl);
    // Offset the copy uniformly (works for every shape type, incl. paths/groups),
    // which also drives Figma-style step-and-repeat via the recorded stepOffset.
    this.offsetElement(newEl, dx, dy);
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
  // Cut/copy/paste live in core/clipboard.ts; AppState owns the manager and the
  // host adapter (built in the constructor) and delegates the public methods.

  copyShape(id: string): void { this.clipboardMgr.copyShape(id); }
  copySelected(): void { this.clipboardMgr.copySelected(); }
  cutShape(id: string): void { this.clipboardMgr.cutShape(id); }
  cutSelected(): void { this.clipboardMgr.cutSelected(); }
  pasteClipboard(): boolean { return this.clipboardMgr.pasteClipboard(); }
  pasteFromSystemClipboard(): Promise<boolean> { return this.clipboardMgr.pasteFromSystemClipboard(); }

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

  /** Record the current document as an undo step. Delegates the navigation
   *  bookkeeping to {@link History}; the document-specific snapshot is built by
   *  {@link captureSnapshot}. */
  saveHistory(): void {
    this.historyMgr.save();
  }

  /** Serialize the live document into a history entry (the History `capture`
   *  callback). Scrubs transient editor-only artifacts so they never reach a
   *  snapshot. */
  private captureSnapshot(): HistoryEntry {
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
    const svgContent = xmlSafeMarkup(this.drawingLayer.innerHTML);
    editing.forEach((w) => w.setAttribute('data-bool-editing', ''));

    return {
      svgContent,
      selectedId: this.selectedShapeId,
      artboardsJson: JSON.stringify(this.artboards),
    };
  }

  /** True when there are edits since the last save/open/new. */
  get dirty(): boolean { return this.historyMgr.dirty; }

  /** Mark the current state as the saved baseline (call after save/open/new). */
  markClean(): void { this.historyMgr.markClean(); }

  undo(): boolean { return this.historyMgr.undo(); }

  redo(): boolean { return this.historyMgr.redo(); }

  get canUndo(): boolean { return this.historyMgr.canUndo; }
  get canRedo(): boolean { return this.historyMgr.canRedo; }

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
    // Artboards now derive from the frame shapes in the restored markup
    // (syncArtboardsCache ran inside rebuildShapesFromDOM above), so there's no
    // separate artboardsJson to parse back.
    this.onChangeCallback();
  }

  rebuildShapesFromDOM(): void {
    this.shapes = [];
    this.shapeById.clear(); // shapes are rebuilt from scratch; drop stale cache
    this.refreshStylesheetProps(); // which paint props an author stylesheet sets

    // Foreign SVGs — and our own "clean"/TraceCraft exports that strip editor
    // ids — commonly have id-less elements. They render fine, but without an id
    // they never entered the model, so the artwork appeared on the canvas with
    // an EMPTY Layers panel. Assign ids so every renderable element becomes a
    // selectable, editable layer.
    //
    // Guardrail: skip this for pathological bulk imports (e.g. a 21MB generative
    // SVG with 100k+ id-less segments). Modeling each as its own layer is both
    // useless to edit and prohibitively slow, so above the cap we keep the old
    // behavior — only elements that already carry an id become layers.
    const assignIds = this.drawingLayer.querySelectorAll('*').length <= AUTO_ID_MODEL_LIMIT;

    // Bump the id counter above every existing shape-N in the tree first, so the
    // ids we assign below can't collide with ids already present (top level or
    // nested inside groups).
    if (assignIds) {
      this.drawingLayer.querySelectorAll('[id]').forEach((el) => {
        const m = (el as SVGElement).id.match(/^shape-(\d+)$/);
        if (m) this.idCounter = Math.max(this.idCounter, parseInt(m[1]));
      });
    }

    const elements = this.drawingLayer.children;

    const processElement = (el: SVGElement): ShapeData | null => {
      const type = this.detectType(el);
      if (!type) return null; // not a renderable shape (metadata, unknown tag)

      let id = el.id;
      if (!id) {
        if (!assignIds) return null; // bulk import — leave id-less elements unmodeled
        id = this.nextId();
        el.id = id;
      }

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

      // A frame contains its children like a group, but its own <clipPath> and
      // .frame-bg rect are managed chrome, not model shapes — skip them.
      if (type === 'frame') {
        shape.children = [];
        for (let j = 0; j < el.children.length; j++) {
          const childEl = el.children[j] as SVGElement;
          const ctag = childEl.tagName.toLowerCase();
          if (ctag === 'clippath' || childEl.classList.contains('frame-bg')) continue;
          const child = processElement(childEl);
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
    this.clearStaleIsolation();
    // Effect <filter> defs aren't in the history snapshot — rebuild them from the
    // round-tripped data-fx-* attrs so blur/shadow survive undo, redo, and load.
    this.ensureEffectFilters();
    // Likewise the shared marker library, if any element references it.
    if (this.drawingLayer.querySelector('[marker-start],[marker-end]')) this.ensureMarkerDefs();
    // Frames are the source of truth; refresh the derived artboards cache that
    // rulers/export/snapping/status-bar read from.
    this.syncArtboardsCache();
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
    if (tag === 'g') {
      if (el.hasAttribute('data-boolean')) return 'boolean';
      if (el.hasAttribute('data-frame')) return 'frame';
      return 'group';
    }
    if (tag === 'image') return 'image';
    if (tag === 'use') return 'use';
    return null;
  }

  /**
   * Scan author `<style>` blocks for which {@link FLATTEN_PROPS} they declare,
   * so {@link flattenInlineStyle} knows which properties need the cascade-
   * preserving guard. Cheap and called once per rebuild; for the common case of
   * no author stylesheet, the result is empty and flattening takes the fast path.
   */
  private refreshStylesheetProps(): void {
    this.stylesheetPaintProps.clear();
    const styles = this.drawingLayer.closest('svg')?.querySelectorAll('style');
    if (!styles || styles.length === 0) return;
    let css = '';
    styles.forEach(s => { css += s.textContent || ''; });
    for (const prop of FLATTEN_PROPS) {
      if (new RegExp(`(^|[\\s{;])${prop}\\s*:`).test(css)) this.stylesheetPaintProps.add(prop);
    }
  }

  /**
   * SVGs imported from other tools (e.g. Inkscape) keep their paint in the CSS
   * `style` attribute. BuzzQuill reads and writes presentation attributes, so we
   * promote inline paint to attributes and drop it from `style` so both stay in
   * sync.
   *
   * Cascade caveat: inline style outranks an author `<style>` rule, but a
   * presentation attribute does not. So when a stylesheet also targets the
   * property, blindly moving it to an attribute can let the stylesheet win and
   * silently change what renders. For those properties we move the value, check
   * the computed result is unchanged, and revert (leaving it as inline style) if
   * it isn't — preferring faithful rendering over editability in that rare clash.
   */
  private flattenInlineStyle(el: SVGElement): void {
    if (!el.getAttribute('style')) return;
    for (const prop of FLATTEN_PROPS) {
      const val = el.style.getPropertyValue(prop);
      if (!val) continue;

      if (this.stylesheetPaintProps.has(prop)) {
        const before = getComputedStyle(el).getPropertyValue(prop);
        const hadAttr = el.hasAttribute(prop);
        const prevAttr = hadAttr ? el.getAttribute(prop) : null;
        el.setAttribute(prop, val);
        el.style.removeProperty(prop);
        if (getComputedStyle(el).getPropertyValue(prop) !== before) {
          // Demotion changed the rendering — a stylesheet rule now wins. Revert.
          el.style.setProperty(prop, val);
          if (hadAttr) el.setAttribute(prop, prevAttr!);
          else el.removeAttribute(prop);
        }
      } else {
        el.setAttribute(prop, val); // inline style wins, so overwrite the attribute
        el.style.removeProperty(prop);
      }
    }
    if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
  }

  private readStyle(el: SVGElement, type: ShapeData['type']): ShapeStyle {
    this.flattenInlineStyle(el);
    // Prefer the presentation attribute, but fall back to inline style for the
    // rare property flattenInlineStyle left inline (a stylesheet-clash revert),
    // so the model still reflects the value that actually renders.
    const attr = (name: string): string | null =>
      el.getAttribute(name) ?? (el.style.getPropertyValue(name) || null);
    if (type === 'group' || type === 'image' || type === 'use' || type === 'boolean') {
      return {
        fill: attr('fill') ?? 'none',
        stroke: attr('stroke') ?? 'none',
        strokeWidth: parseFloat(attr('stroke-width') ?? '0'),
        opacity: parseFloat(attr('opacity') ?? '1'),
      };
    }
    const fill = attr('fill') ?? (type === 'line' ? 'none' : '#FFFFFF');
    const stroke = attr('stroke') ?? '#000000';
    // Inside/outside alignment renders at double width (see stroke-align.ts);
    // the data-stroke-align marker lets us recover the authored width.
    const align = el.getAttribute('data-stroke-align');
    const rawWidth = parseFloat(attr('stroke-width') ?? '1');
    const strokeWidth = (align === 'inside' || align === 'outside') ? rawWidth / 2 : rawWidth;
    const opacity = parseFloat(attr('opacity') ?? '1');
    const style: ShapeStyle = { fill, stroke, strokeWidth, opacity };
    style.fillOpacity = parseFloat(attr('fill-opacity') ?? '1');
    style.strokeOpacity = parseFloat(attr('stroke-opacity') ?? '1');
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
    // Ungrouping a clip group would delete the clip shape (it lives in a non-model
    // <clipPath>). Release the mask instead, which restores it as a normal child.
    if (group.element.hasAttribute('data-clip-group')) { this.releaseClippingMask(id); return; }

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

  // ---- Shape Builder support ----

  /**
   * Decompose the current top-level selection into its arrangement faces (the
   * atomic regions of the overlapping shapes), in drawing-layer space. Used by the
   * Shape Builder tool for hit-testing and merge/delete. Returns null if fewer than
   * two shapes are selected.
   */
  async selectionFaces(): Promise<{ faces: string[]; ids: string[] } | null> {
    const operands = this.shapes.filter((s) =>
      this.selectedShapeIds.includes(s.id) &&
      ['path', 'rect', 'ellipse', 'polygon', 'polyline', 'line', 'boolean', 'group'].includes(s.type));
    if (operands.length < 2) return null;
    await ensureBooleanEngine();
    const ds = this.operandDsInLayerSpace(operands);
    if (!ds) return null;
    const faces = computeBoolean(ds, 'divide').filter((d) => d.trim());
    if (faces.length === 0) return null;
    return { faces, ids: operands.map((s) => s.id) };
  }

  /**
   * Commit a Shape Builder session: remove the original shapes and add the built
   * result paths (already in drawing-layer space), each filled with `fill`. Adds
   * them at the z-position of the lowest original. Selects the results.
   */
  replaceShapesWithPaths(originalIds: string[], resultDs: string[], fill: string): void {
    for (const id of originalIds) this.detachShape(id); // remove without per-shape history

    const SVG = 'http://www.w3.org/2000/svg';
    const newIds: string[] = [];
    for (const d of resultDs) {
      if (!d.trim()) continue;
      const el = document.createElementNS(SVG, 'path');
      const id = this.nextId();
      el.id = id;
      el.setAttribute('d', d);
      el.setAttribute('fill', fill);
      el.setAttribute('fill-rule', 'evenodd');
      el.setAttribute('data-name', `Shape ${id.replace('shape-', '#')}`);
      this.drawingLayer.appendChild(el);
      newIds.push(id);
    }
    this.selectedShapeIds = newIds;
    this.rebuildShapesFromDOM();
    this.selectedShapeIds = newIds;
    this.saveHistory();
    this.onChangeCallback();
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

  /**
   * Replace a primitive element (rect, ellipse, polygon/star, line, polyline) with
   * an equivalent `<path>` in place, preserving id, paint, transform, name and any
   * operand tagging — everything but the primitive's geometry attributes. Geometry
   * is exact (its local d). Returns false for types with no single-path equivalent
   * (path itself, group, text, image, use, boolean), which can't be node-edited.
   */
  private convertShapeToPath(shape: ShapeData): boolean {
    const CONVERTIBLE: ReadonlyArray<ShapeData['type']> = ['rect', 'ellipse', 'line', 'polyline', 'polygon'];
    if (!CONVERTIBLE.includes(shape.type)) return false;
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

  // ---- Outline Stroke / Offset Path (paperjs-offset via the boolean engine) ----

  private static readonly PATHABLE: ReadonlyArray<ShapeData['type']> =
    ['path', 'rect', 'ellipse', 'line', 'polyline', 'polygon'];

  /**
   * Convert the stroke of each selected stroked object into a filled outline path
   * (Illustrator's Object → Path → Outline Stroke). If the object also has a fill,
   * the fill body is kept and the outline is added above it in a group; a fill-less
   * shape is replaced outright. Returns false if nothing had an outline-able stroke.
   */
  async outlineSelectedStroke(): Promise<boolean> {
    const targets = this.selectedShapeIds
      .map(id => this.findShapeById(id))
      .filter((s): s is ShapeData => !!s && AppState.PATHABLE.includes(s.type))
      .filter(s => {
        const stroke = s.element.getAttribute('stroke');
        const w = parseFloat(s.element.getAttribute('stroke-width') ?? '0');
        return !!stroke && stroke !== 'none' && w > 0;
      });
    if (targets.length === 0) return false;

    await ensureOffsetEngine();
    const resultIds: string[] = [];
    for (const s of targets) {
      const id = this.outlineOneStroke(s);
      if (id) resultIds.push(id);
    }
    this.rebuildShapesFromDOM();
    if (resultIds.length) this.selectedShapeIds = resultIds;
    this.saveHistory();
    this.onChangeCallback();
    return true;
  }

  /** Outline one shape's stroke; returns the id of the resulting top-level element. */
  private outlineOneStroke(shape: ShapeData): string | null {
    const el = shape.element;
    const localD = shape.type === 'path' ? (el.getAttribute('d') ?? '') : localPathData(el);
    if (!localD.trim()) return null;
    const align = el.getAttribute('data-stroke-align');
    let width = parseFloat(el.getAttribute('stroke-width') ?? '1');
    if (align === 'inside' || align === 'outside') width /= 2; // recover authored width
    const rawJoin = el.getAttribute('stroke-linejoin');
    const join: StrokeJoin = rawJoin === 'round' || rawJoin === 'bevel' ? rawJoin : 'miter';
    const cap: StrokeCap = el.getAttribute('stroke-linecap') === 'round' ? 'round' : 'butt';
    const outlineD = outlineStrokeData(localD, width, join, cap);
    if (!outlineD.trim()) return null;

    const SVG = 'http://www.w3.org/2000/svg';
    const outline = document.createElementNS(SVG, 'path');
    outline.setAttribute('d', outlineD);
    outline.setAttribute('fill', el.getAttribute('stroke') ?? '#000000');
    outline.setAttribute('fill-rule', 'nonzero');
    const so = el.getAttribute('stroke-opacity'); if (so) outline.setAttribute('fill-opacity', so);
    const tf = el.getAttribute('transform'); if (tf) outline.setAttribute('transform', tf);

    const fill = el.getAttribute('fill');
    if (!fill || fill === 'none') {
      // No fill body: the outline simply replaces the shape.
      outline.id = shape.id;
      const name = el.getAttribute('data-name'); if (name) outline.setAttribute('data-name', name);
      el.replaceWith(outline);
      return shape.id;
    }
    // Keep the fill body (minus its stroke), group it under the outline.
    for (const a of ['stroke', 'stroke-width', 'stroke-linejoin', 'stroke-linecap', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'data-stroke-align', 'clip-path']) {
      el.removeAttribute(a);
    }
    const g = document.createElementNS(SVG, 'g');
    const gid = this.nextId();
    g.id = gid;
    g.setAttribute('data-name', 'Outlined Stroke');
    outline.id = this.nextId();
    el.replaceWith(g);
    g.appendChild(el);
    g.appendChild(outline);
    return gid;
  }

  /**
   * Offset every selected path outward (positive) or inward (negative) by `delta`,
   * in place, preserving curves (Illustrator's Object → Path → Offset Path).
   * Primitives are converted to paths first. Returns false if nothing changed.
   */
  async offsetSelectedPath(delta: number): Promise<boolean> {
    if (!delta) return false;
    const shapes = this.selectedShapeIds
      .map(id => this.findShapeById(id))
      .filter((s): s is ShapeData => !!s && AppState.PATHABLE.includes(s.type));
    if (shapes.length === 0) return false;

    await ensureOffsetEngine();
    let changed = false;
    for (const s of shapes) {
      if (s.type !== 'path' && !this.convertShapeToPath(s)) continue;
      const d = s.element.getAttribute('d') ?? '';
      const out = offsetPathData(d, delta, 'miter');
      if (out.trim()) { s.element.setAttribute('d', out); changed = true; }
    }
    if (!changed) return false;
    this.saveHistory();
    this.onChangeCallback();
    return true;
  }

  // ---- Clipping masks ----

  /**
   * Make a clipping mask from the selection (Illustrator's ⌘7): the TOPMOST
   * selected object becomes the mask, and everything below it is wrapped in a
   * group clipped to that shape. The mask geometry lives in an inline `<clipPath>`
   * *inside* the group, so the whole thing round-trips through history markup (no
   * defs needed — defs aren't part of the innerHTML snapshot). Returns false when
   * fewer than two shapes are selected.
   */
  makeClippingMask(): boolean {
    const idSet = new Set(this.selectedShapeIds);
    const members: ShapeData[] = [];
    const remaining: ShapeData[] = [];
    let insertIdx = -1;
    for (const s of this.shapes) {
      if (idSet.has(s.id)) { if (insertIdx === -1) insertIdx = remaining.length; members.push(s); }
      else remaining.push(s);
    }
    if (members.length < 2) return false;

    const clip = members[members.length - 1]; // topmost = the mask
    const clipped = members.slice(0, -1);

    const SVG = 'http://www.w3.org/2000/svg';
    const gEl = document.createElementNS(SVG, 'g');
    const groupId = this.nextId();
    gEl.id = groupId;
    const name = `Clip Group ${groupId.replace('shape-', '#')}`;
    gEl.setAttribute('data-name', name);
    gEl.setAttribute('data-clip-group', '');
    const clipId = `clipmask-${groupId.replace('shape-', '')}`;
    gEl.setAttribute('clip-path', `url(#${clipId})`);

    // The mask shape moves into a non-rendering <clipPath>; it's consumed as the
    // clip region (matches Illustrator, where the top object becomes the mask).
    const clipPathEl = document.createElementNS(SVG, 'clipPath');
    clipPathEl.setAttribute('id', clipId);
    clipPathEl.appendChild(clip.element);
    gEl.appendChild(clipPathEl);

    for (const s of clipped) { gEl.appendChild(s.element); s.parentId = groupId; }

    const insertBefore = remaining[insertIdx]?.element ?? null;
    if (insertBefore) this.drawingLayer.insertBefore(gEl, insertBefore);
    else this.drawingLayer.appendChild(gEl);

    const groupShape: ShapeData = {
      id: groupId, type: 'group', element: gEl, name,
      style: { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1 },
      visible: true, locked: false, children: clipped,
    };
    remaining.splice(insertIdx < 0 ? remaining.length : insertIdx, 0, groupShape);
    this.shapes = remaining;
    this.selectedShapeIds = [groupId];
    this.saveHistory();
    this.onChangeCallback();
    return true;
  }

  /** Release a clipping mask: restore the mask shape as a normal top child and
   *  drop the clip, leaving a plain group (Illustrator's ⌘⌥7). */
  releaseClippingMask(id: string): void {
    const shape = this.findShapeById(id);
    if (!shape || !shape.element.hasAttribute('data-clip-group')) return;
    const gEl = shape.element;
    const clipPathEl = Array.from(gEl.children).find(c => c.tagName.toLowerCase() === 'clippath');
    const clipShape = clipPathEl?.firstElementChild as SVGElement | null;
    if (clipShape) gEl.appendChild(clipShape); // back on top, as a normal child
    clipPathEl?.remove();
    gEl.removeAttribute('clip-path');
    gEl.removeAttribute('data-clip-group');
    gEl.setAttribute('data-name', `Group ${id.replace('shape-', '#')}`);
    this.rebuildShapesFromDOM();
    this.selectedShapeIds = [id];
    this.saveHistory();
    this.onChangeCallback();
  }

  // ---- Effects (blur / drop shadow via SVG filters) ----
  //
  // Effect parameters are the source of truth and live as data-fx-* attributes on
  // the element, so they round-trip through the history/innerHTML snapshot. The
  // SVG <filter> in <defs> is a regenerated CACHE (defs aren't snapshotted), so
  // ensureEffectFilters() rebuilds it after every rebuildShapesFromDOM/import.

  getObjectEffects(id: string): { blur: number; shadow: ObjectShadow | null } {
    const el = this.findShapeById(id)?.element;
    const blur = el ? (parseFloat(el.getAttribute('data-fx-blur') || '0') || 0) : 0;
    let shadow: ObjectShadow | null = null;
    const sa = el?.getAttribute('data-fx-shadow');
    if (sa) {
      const [dx, dy, b, color, op] = sa.split(',');
      shadow = { dx: parseFloat(dx) || 0, dy: parseFloat(dy) || 0, blur: parseFloat(b) || 0, color: color || '#000000', opacity: parseFloat(op) || 0 };
    }
    return { blur, shadow };
  }

  // `record` lets a slider apply live on `input` (record=false) and commit one
  // history entry on `change` (record=true), so a drag doesn't flood undo.
  setObjectBlur(id: string, stdDev: number, record = true): void {
    const el = this.findShapeById(id)?.element;
    if (!el) return;
    if (stdDev > 0) el.setAttribute('data-fx-blur', String(stdDev));
    else el.removeAttribute('data-fx-blur');
    this.applyEffectFilter(el);
    if (record) this.saveHistory();
    this.onChangeCallback();
  }

  setObjectShadow(id: string, shadow: ObjectShadow | null, record = true): void {
    const el = this.findShapeById(id)?.element;
    if (!el) return;
    if (shadow) el.setAttribute('data-fx-shadow', `${shadow.dx},${shadow.dy},${shadow.blur},${shadow.color},${shadow.opacity}`);
    else el.removeAttribute('data-fx-shadow');
    this.applyEffectFilter(el);
    if (record) this.saveHistory();
    this.onChangeCallback();
  }

  // ---- Markers (arrowheads / dots on line & path ends) ----
  //
  // The marker-start/marker-end presentation attributes round-trip through the
  // history snapshot; the shared <marker> library lives in <defs> and is rebuilt
  // by ensureMarkerDefs() (defs aren't snapshotted). fill="context-stroke" makes
  // each arrowhead match its path's stroke colour.

  /** Create the standard marker library in <defs> once (idempotent). */
  ensureMarkerDefs(): void {
    const defs = this.ensureDefs();
    if (defs.querySelector('[id="mk-arrow"]')) return;
    const SVG = 'http://www.w3.org/2000/svg';
    const make = (id: string, w: string, h: string, refX: string, inner: string) => {
      const m = document.createElementNS(SVG, 'marker');
      m.setAttribute('id', id);
      m.setAttribute('viewBox', '0 0 10 10');
      m.setAttribute('markerUnits', 'strokeWidth');
      m.setAttribute('orient', 'auto-start-reverse');
      m.setAttribute('markerWidth', w); m.setAttribute('markerHeight', h);
      m.setAttribute('refX', refX); m.setAttribute('refY', '5');
      m.innerHTML = inner;
      defs.appendChild(m);
    };
    make('mk-arrow', '8', '8', '9', '<path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/>');
    make('mk-dot', '6', '6', '5', '<circle cx="5" cy="5" r="4" fill="context-stroke"/>');
    make('mk-open', '9', '9', '8', '<path d="M1,1 L9,5 L1,9" fill="none" stroke="context-stroke" stroke-width="1.5"/>');
  }

  getMarkers(id: string): { start: string; end: string } {
    const el = this.findShapeById(id)?.element;
    const read = (attr: string) => el?.getAttribute(attr)?.match(/url\(#(mk-[a-z]+)\)/)?.[1] ?? '';
    return { start: read('marker-start'), end: read('marker-end') };
  }

  setMarker(id: string, pos: 'start' | 'end', markerId: string | null): void {
    const el = this.findShapeById(id)?.element;
    if (!el) return;
    this.ensureMarkerDefs();
    const attr = `marker-${pos}`;
    if (markerId) el.setAttribute(attr, `url(#${markerId})`);
    else el.removeAttribute(attr);
    this.saveHistory();
    this.onChangeCallback();
  }

  /** Blend mode (mix-blend-mode) of an object; 'normal' = none. Stored as inline
   *  style, which round-trips through the history/innerHTML snapshot. */
  getBlendMode(id: string): string {
    const el = this.findShapeById(id)?.element as SVGElement | undefined;
    return el?.style.mixBlendMode || 'normal';
  }

  setBlendMode(id: string, mode: string): void {
    const el = this.findShapeById(id)?.element as SVGElement | undefined;
    if (!el) return;
    if (mode && mode !== 'normal') el.style.mixBlendMode = mode;
    else el.style.removeProperty('mix-blend-mode');
    if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
    this.saveHistory();
    this.onChangeCallback();
  }

  /** (Re)build or remove an element's `<filter>` from its data-fx-* attributes. */
  private applyEffectFilter(el: SVGElement): void {
    const blur = parseFloat(el.getAttribute('data-fx-blur') || '0') || 0;
    const shadowAttr = el.getAttribute('data-fx-shadow');
    const fid = `fx-${el.id}`;
    const defs = this.ensureDefs();
    defs.querySelector(`[id="${fid}"]`)?.remove();

    if (blur <= 0 && !shadowAttr) {
      if (el.getAttribute('filter') === `url(#${fid})`) el.removeAttribute('filter');
      return;
    }
    const SVG = 'http://www.w3.org/2000/svg';
    const filter = document.createElementNS(SVG, 'filter');
    filter.setAttribute('id', fid);
    // Roomy region so blur / shadow spread isn't clipped.
    filter.setAttribute('x', '-50%'); filter.setAttribute('y', '-50%');
    filter.setAttribute('width', '200%'); filter.setAttribute('height', '200%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    let input = 'SourceGraphic';
    if (blur > 0) {
      const fe = document.createElementNS(SVG, 'feGaussianBlur');
      fe.setAttribute('in', input); fe.setAttribute('stdDeviation', String(blur));
      fe.setAttribute('result', 'fxblur'); filter.appendChild(fe); input = 'fxblur';
    }
    if (shadowAttr) {
      const [dx, dy, b, color, op] = shadowAttr.split(',');
      const fe = document.createElementNS(SVG, 'feDropShadow');
      fe.setAttribute('in', input);
      fe.setAttribute('dx', dx || '0'); fe.setAttribute('dy', dy || '0');
      fe.setAttribute('stdDeviation', b || '0');
      fe.setAttribute('flood-color', color || '#000000');
      fe.setAttribute('flood-opacity', op || '1');
      filter.appendChild(fe);
    }
    defs.appendChild(filter);
    el.setAttribute('filter', `url(#${fid})`);
  }

  /** Regenerate every effect filter from its element's data-fx-* attrs (defs are
   *  not part of the history snapshot, so they must be rebuilt after restore). */
  private ensureEffectFilters(): void {
    this.drawingLayer.querySelectorAll('[data-fx-blur],[data-fx-shadow]')
      .forEach((el) => this.applyEffectFilter(el as SVGElement));
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

  // ---- Symbols ---- (create-from-shape / place / detach / remove live in
  // core/symbol-registry.ts; AppState delegates and supplies the host adapter.)

  createSymbolFromShape(shapeId: string): SymbolDef | null {
    return this.symbolRegistry.createSymbolFromShape(shapeId);
  }

  placeSymbolInstance(symId: string): void {
    this.symbolRegistry.placeSymbolInstance(symId);
  }

  detachSymbolInstance(shapeId: string): void {
    this.symbolRegistry.detachSymbolInstance(shapeId);
  }

  removeSymbol(id: string): void {
    this.symbolRegistry.removeSymbol(id);
  }

  // ---- Gradient management ----

  createGradient(type: 'linear' | 'radial', stops?: GradientStop[]): GradientDef {
    return this.paint.createGradient(type, stops);
  }

  updateGradient(grad: GradientDef): void {
    this.paint.updateGradient(grad);
  }

  removeGradient(id: string): void {
    this.paint.removeGradient(id);
  }

  getGradientById(id: string): GradientDef | undefined {
    return this.paint.getGradientById(id);
  }

  // ---- Pattern management ----

  createPattern(def: Partial<PatternDef> & { type: PatternDef['type'] }): PatternDef {
    return this.paint.createPattern(def);
  }

  updatePattern(pat: PatternDef): void {
    this.paint.updatePattern(pat);
  }

  removePattern(id: string): void {
    this.paint.removePattern(id);
  }

  getPatternById(id: string): PatternDef | undefined {
    return this.paint.getPatternById(id);
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
    return xmlSafeMarkup(parts.join('\n'));
  }

  getDefsBlock(): string {
    const content = this.getDefsContent();
    return content ? `<defs>${content}</defs>\n` : '';
  }

  /** Record non-standard `xmlns:` prefixes from an imported root <svg>. */
  private captureNamespaces(svgEl: Element): void {
    const ALWAYS_EMITTED = new Set(['xlink', 'inkscape', 'sodipodi', 'svg']);
    for (const attr of Array.from(svgEl.attributes)) {
      const m = /^xmlns:(.+)$/.exec(attr.name);
      if (m && !ALWAYS_EMITTED.has(m[1]) && attr.value) {
        this.importedNamespaces.set(m[1], attr.value);
      }
    }
  }

  /**
   * Extra ` xmlns:p="uri"` declarations to splice into a serialized root <svg>,
   * beyond the always-emitted xlink/inkscape/sodipodi. Keeps files that use
   * custom prefixes (Adobe i/x/graph, bx, …) valid XML on save → reload.
   */
  getExtraNamespaceDecls(): string {
    let out = '';
    for (const [prefix, uri] of this.importedNamespaces) {
      out += ` xmlns:${prefix}="${uri.replace(/"/g, '&quot;')}"`;
    }
    return out;
  }

  getDrawingLayerSVG(): string {
    return xmlSafeMarkup(this.drawingLayer.innerHTML);
  }

  /** Like {@link getDrawingLayerSVG} but with live-boolean operands stripped, so
   *  exported files contain only the computed result paths (no hidden source
   *  geometry). Save/load uses the raw form above to keep booleans editable. */
  getDrawingLayerSVGForExport(): string {
    if (!this.drawingLayer.querySelector('[data-boolean]')) return xmlSafeMarkup(this.drawingLayer.innerHTML);
    const clone = this.drawingLayer.cloneNode(true) as SVGGElement;
    stripBooleanOperands(clone);
    return xmlSafeMarkup(clone.innerHTML);
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
    this.symbolRegistry.clear(); // symbol models + counter
    this.paint.clear(); // gradients/patterns models + counters
    this.importedNamespaces.clear();
    // Remove imported/user defs but keep the editor's grid & transparency
    // patterns, which live in this same <defs> and back the canvas chrome.
    if (this.defsElement) {
      for (const child of Array.from(this.defsElement.children)) {
        if (!EDITOR_DEF_IDS.has(child.id)) child.remove();
      }
    }
  }

  private importDefsFromSVG(svgEl: Element): void {
    // Capture any non-standard xmlns prefixes so prefixed content stays valid
    // XML when we re-serialize (see importedNamespaces).
    this.captureNamespaces(svgEl);

    // A file may carry several <defs> blocks (matplotlib scatters one clipPath
    // per <defs>; some tools nest them). Pull every entry, not just the first,
    // or referenced clips/filters silently vanish.
    const defsChildren: Element[] = [];
    for (const defsEl of Array.from(svgEl.querySelectorAll('defs'))) {
      defsChildren.push(...Array.from(defsEl.children));
    }
    if (defsChildren.length === 0) return;

    for (const child of defsChildren) {
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
        if (tag === 'symbol') this.symbolRegistry.trackImportedSymbol(imported);
        continue;
      }

      if (tag === 'lineargradient' || tag === 'radialgradient') {
        this.paint.importGradientElement(child);
      }

      if (tag === 'pattern') {
        this.paint.importPatternElement(child);
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
    // Detect SMIL animation before the sanitizer strips it, so the UI can warn.
    this.lastImportHadAnimation = !!svgEl.querySelector(
      'animate, animateTransform, animateMotion, animateColor, set',
    );
    this.drawingLayer.innerHTML = '';
    this.shapes = [];

    // 1. Bring across the full <defs> (filters, clipPaths, masks, markers,
    //    symbols, gradients, patterns, referenced templates) so every reference
    //    in the artwork resolves once the content lands in the live document.
    this.importDefsFromSVG(svgEl);

    // 2. Faithfully clone each rendering child, ids and references intact.
    //    Non-rendering containers/metadata are skipped (defs is handled above).
    //    The clones are sanitized inside a DETACHED staging group before any of
    //    them touch the live document — stripping event handlers, unsafe hrefs,
    //    and whole blocked elements (incl. a top-level <script>/<foreignObject>,
    //    which sanitizing a node in isolation can't remove from itself). This
    //    keeps the invariant "nothing unsanitized enters the live DOM" without
    //    relying on event-loop timing (matches the paste paths).
    const NON_RENDERING = new Set(['defs', 'metadata', 'title', 'desc', 'namedview']);
    const staging = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    for (const child of Array.from(svgEl.children)) {
      if (NON_RENDERING.has(child.localName.toLowerCase())) continue;
      staging.appendChild(document.importNode(child, true));
    }
    sanitizeSvgElement(staging); // off-document; drops blocked roots too
    while (staging.firstChild) this.drawingLayer.appendChild(staging.firstChild);

    // 3. Strip Inkscape's degenerate subpaths (anchors collapsed to a point with
    //    control points flung to the origin) — invisible when filled but a stray
    //    line when stroked. This is the one intentional deviation from raw input.
    for (const pathEl of Array.from(this.drawingLayer.querySelectorAll('path'))) {
      const d = pathEl.getAttribute('d');
      if (!d) continue;
      const { d: clean, removed } = sanitizePathData(d);
      if (removed > 0) pathEl.setAttribute('d', clean);
    }

    // 4. Build the editor model from whatever was imported.
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
