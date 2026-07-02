import type { ToolName, ShapeData, HistoryEntry, ShapeStyle, Artboard, SymbolDef, GradientDef, GradientStop, PatternDef, ObjectShadow, AppearanceLayer, FrameGrid } from './types';
import { ensureSvgNamespaces } from './svg-ns';
import { sanitizePathData } from './path-sanitize';
import { sanitizeSvgElement, sanitizeSvgMarkup } from './svg-sanitize';
import { PathEditSession } from './path-edit';
import { History, type HistorySnapshot } from './history';
import { PaintRegistry } from './paint-registry';
import { ClipboardManager, type ClipboardHost } from './clipboard';
import { SymbolRegistry, type SymbolHost } from './symbol-registry';
import { EffectsManager, type EffectsHost } from './effects';
import { MarkersManager, type MarkersHost } from './markers';
import { AppearanceManager, type AppearanceHost } from './appearance';
import { WidthStrokeManager, type WidthStrokeHost } from './width-stroke';
import { PathfinderManager, type PathfinderHost } from './pathfinder';
import { LayerManager, type LayerHost } from './layers';
import { nudgeTranslate, getRotation } from './transform';
import { applyStrokeAlignment, STROKE_CLIP_PREFIX } from './stroke-align';
import {
  type BooleanOp,
  ensureBooleanEngine, booleanEngineReady, stripBooleanOperands, localPathData,
} from './boolean';
import type { WidthPoint } from './variable-width';

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
  /** Undo/redo stack. Owns the index/branching/cap bookkeeping; this class
   *  supplies the document capture/restore via {@link captureSnapshot} /
   *  {@link restoreHistory}. See core/history.ts. */
  private historyMgr: History;
  private drawingLayer: SVGGElement;
  private onChangeCallback: () => void;

  artboards: Artboard[] = [];
  activeFrameId: string | null = null;
  selectedFrameId: string | null = null; // used by artboard tool

  /** Lets a tool ask the app to switch tools (e.g. a draw tool returns to Select
   *  after placing one shape). Wired by main.ts to setTool; null in headless use. */
  requestTool: ((tool: ToolName) => void) | null = null;

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
  private effects: EffectsManager;
  private markers: MarkersManager;
  private appearanceMgr: AppearanceManager;
  private widthMgr: WidthStrokeManager;
  private pathfinder: PathfinderManager;
  private layerMgr: LayerManager;

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
    const effectsHost: EffectsHost = {
      ensureDefs: () => this.ensureDefs(),
      getDrawingLayer: () => this.drawingLayer,
      findShapeElement: (id) => this.findShapeById(id)?.element ?? null,
      selectionElements: () => this.selectionElements(),
      saveHistory: () => this.saveHistory(),
      onChange: () => this.onChangeCallback(),
    };
    this.effects = new EffectsManager(effectsHost);
    const markersHost: MarkersHost = {
      ensureDefs: () => this.ensureDefs(),
      findShapeElement: (id) => this.findShapeById(id)?.element ?? null,
      selectionElements: () => this.selectionElements(),
      saveHistory: () => this.saveHistory(),
      onChange: () => this.onChangeCallback(),
    };
    this.markers = new MarkersManager(markersHost);
    const appearanceHost: AppearanceHost = {
      findShape: (id) => this.findShapeById(id),
      applyEffectFilter: (el) => this.effects.applyFilter(el),
      rebuild: () => this.rebuildShapesFromDOM(),
      setSelection: (ids) => { this.selectedShapeIds = ids; },
      saveHistory: () => this.saveHistory(),
      onChange: () => this.onChangeCallback(),
    };
    this.appearanceMgr = new AppearanceManager(appearanceHost);
    const widthHost: WidthStrokeHost = {
      findShape: (id) => this.findShapeById(id),
      applyEffectFilter: (el) => this.effects.applyFilter(el),
      rebuild: () => this.rebuildShapesFromDOM(),
      setSelection: (ids) => { this.selectedShapeIds = ids; },
      saveHistory: () => this.saveHistory(),
      onChange: () => this.onChangeCallback(),
    };
    this.widthMgr = new WidthStrokeManager(widthHost);
    const pathfinderHost: PathfinderHost = {
      getShapes: () => this.shapes,
      getSelectedIds: () => this.selectedShapeIds,
      setSelection: (ids) => { this.selectedShapeIds = ids; },
      getDrawingLayer: () => this.drawingLayer,
      findShape: (id) => this.findShapeById(id),
      nextId: () => this.nextId(),
      selectedInDomOrder: () => this.selectedInDomOrder(),
      commonParentOf: (shapes) => this.commonParentOf(shapes),
      convertShapeToPath: (shape) => this.convertShapeToPath(shape),
      detachShape: (id) => this.detachShape(id),
      exitGroupIsolation: () => this.exitGroupIsolation(),
      rebuild: () => this.rebuildShapesFromDOM(),
      saveHistory: () => this.saveHistory(),
      onChange: () => this.onChangeCallback(),
    };
    this.pathfinder = new PathfinderManager(pathfinderHost);
    const layerHost: LayerHost = {
      getShapes: () => this.shapes,
      setShapes: (shapes) => { this.shapes = shapes; },
      getSelectedIds: () => this.selectedShapeIds,
      setSelection: (ids) => { this.selectedShapeIds = ids; },
      getDrawingLayer: () => this.drawingLayer,
      findShape: (id) => this.findShapeById(id),
      nextId: () => this.nextId(),
      offsetElement: (el, dx, dy) => this.offsetElement(el, dx, dy),
      reIdGroupChildren: (el) => this.reIdGroupChildren(el),
      rebuild: () => this.rebuildShapesFromDOM(),
      saveHistory: () => this.saveHistory(),
      onChange: () => this.onChangeCallback(),
    };
    this.layerMgr = new LayerManager(layerHost);
    // Create the default frame ("Frame 1"). Frames are real <g data-frame>
    // container-shapes in the drawing layer; rebuildShapesFromDOM derives the
    // artboards cache from them.
    this.drawingLayer.appendChild(this.createFrameElement(0, 0, 960, 540, 'Frame 1'));
    this.rebuildShapesFromDOM();
    this.activeFrameId = this.artboards[0]?.id ?? null;
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
    // Dim default frame background — easier on the eyes than a pure-white artboard.
    bg.setAttribute('fill', '#333333');
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
      grid: this.parseFrameGrid(s.element),
      rulers: s.element.getAttribute('data-frame-rulers') === '1',
    };
  }

  // ---- Frame grid & rulers (editor chrome; per-frame, persisted on the frame) --
  //
  // A frame can carry a uniform layout grid (data-grid-*) and edge rulers
  // (data-frame-rulers). These attributes round-trip through the history/innerHTML
  // snapshot; the on-canvas drawing is derived chrome regenerated by the frame
  // renderer, so grids/rulers never leak into exported artwork.

  private parseFrameGrid(el: SVGElement): FrameGrid | null {
    if (!el.hasAttribute('data-grid')) return null;
    return {
      size: Math.max(1, parseFloat(el.getAttribute('data-grid-size') ?? '8') || 8),
      subdivisions: Math.max(1, Math.round(parseFloat(el.getAttribute('data-grid-subdiv') ?? '1') || 1)),
      color: el.getAttribute('data-grid-color') || '#7f8fa6',
      visible: el.getAttribute('data-grid-hidden') !== '1',
      snap: el.getAttribute('data-grid-snap') === '1',
    };
  }

  /** A frame's grid config, or null if it has none. */
  getFrameGrid(id: string): FrameGrid | null {
    const el = this.frameShapeById(id)?.element;
    return el ? this.parseFrameGrid(el) : null;
  }

  /** Set (or clear, with null) a frame's grid. One undo step when `record`. */
  setFrameGrid(id: string, grid: FrameGrid | null, record = true): void {
    const el = this.frameShapeById(id)?.element;
    if (!el) return;
    if (!grid) {
      for (const a of ['data-grid', 'data-grid-size', 'data-grid-subdiv', 'data-grid-color', 'data-grid-hidden', 'data-grid-snap']) el.removeAttribute(a);
    } else {
      el.setAttribute('data-grid', '1');
      el.setAttribute('data-grid-size', String(Math.max(1, grid.size)));
      el.setAttribute('data-grid-subdiv', String(Math.max(1, Math.round(grid.subdivisions))));
      el.setAttribute('data-grid-color', grid.color);
      if (grid.visible) el.removeAttribute('data-grid-hidden'); else el.setAttribute('data-grid-hidden', '1');
      if (grid.snap) el.setAttribute('data-grid-snap', '1'); else el.removeAttribute('data-grid-snap');
    }
    this.syncArtboardsCache();
    if (record) this.saveHistory();
    this.onChangeCallback();
  }

  getFrameRulers(id: string): boolean {
    return this.frameShapeById(id)?.element.getAttribute('data-frame-rulers') === '1';
  }

  setFrameRulers(id: string, on: boolean, record = true): void {
    const el = this.frameShapeById(id)?.element;
    if (!el) return;
    if (on) el.setAttribute('data-frame-rulers', '1'); else el.removeAttribute('data-frame-rulers');
    this.syncArtboardsCache();
    if (record) this.saveHistory();
    this.onChangeCallback();
  }

  /** Grid-snap parameters for the active frame (origin + spacing), or null when no
   *  active frame has snapping on. Used by the select tool to quantize gestures. */
  activeGridSnap(): { ox: number; oy: number; step: number } | null {
    const id = this.activeFrameId;
    if (!id) return null;
    const ab = this.artboards.find(a => a.id === id);
    if (!ab || !ab.grid || !ab.grid.snap) return null;
    return { ox: ab.x, oy: ab.y, step: ab.grid.size };
  }

  /** Rebuild the derived artboards cache from the top-level frame shapes. */
  private syncArtboardsCache(): void {
    this.artboards = this.shapes.filter(s => s.type === 'frame').map(s => this.frameToArtboard(s));
    if (!this.artboards.some(a => a.id === this.activeFrameId)) {
      this.activeFrameId = this.artboards[0]?.id ?? null;
    }
  }

  private frameShapeById(id: string): ShapeData | undefined {
    return this.shapes.find(s => s.type === 'frame' && s.id === id);
  }

  getActiveFrame(): ShapeData | null {
    return this.frameShapeById(this.activeFrameId ?? '')
      ?? this.shapes.find(s => s.type === 'frame') ?? null;
  }

  /** The top-level frame whose world bounds contain (cx, cy), else null. */
  /** A frame's ORIGIN in world (drawing-layer) coordinates, accumulating ancestor
   *  frame transforms so nested frames convert coordinates correctly. Frames are
   *  translate-only, so the composed matrix's e/f are the world origin. */
  private frameWorldOrigin(el: SVGElement): { x: number; y: number } {
    const layer = this.drawingLayer.getScreenCTM();
    const own = (el as unknown as SVGGraphicsElement).getScreenCTM();
    if (!layer || !own) return this.frameTranslate(el); // detached fallback
    const m = layer.inverse().multiply(own);
    return { x: m.e, y: m.f };
  }

  /** The DEEPEST frame whose world bounds contain (cx, cy), or null. Scans every
   *  frame element (including nested ones), not just top-level frames. */
  private frameAtPoint(cx: number, cy: number): ShapeData | null {
    let best: SVGElement | null = null;
    let bestDepth = -1;
    for (const el of Array.from(this.drawingLayer.querySelectorAll('g[data-frame]')) as SVGElement[]) {
      const o = this.frameWorldOrigin(el);
      const w = parseFloat(el.getAttribute('data-frame-w') ?? '0');
      const h = parseFloat(el.getAttribute('data-frame-h') ?? '0');
      if (cx < o.x || cx > o.x + w || cy < o.y || cy > o.y + h) continue;
      let depth = 0;
      const layer: Element = this.drawingLayer;
      for (let p: Element | null = el.parentElement; p && p !== layer; p = p.parentElement) {
        if (p.hasAttribute('data-frame')) depth++;
      }
      if (depth > bestDepth) { bestDepth = depth; best = el; }
    }
    return best ? this.findShapeById(best.id) : null;
  }

  // Keep the legacy getter for backward compat with align, export, etc.
  get artboard(): Artboard {
    return this.getActiveArtboard();
  }

  getActiveArtboard(): Artboard {
    return this.artboards.find(a => a.id === this.activeFrameId)
      ?? this.artboards[0]
      // Safety net for documents with no frame yet (e.g. an old file mid-migration):
      // a default view so rulers/export/status never read `undefined`.
      ?? { id: '', x: 0, y: 0, width: 960, height: 540, name: 'Frame' };
  }

  getArtboardById(id: string): Artboard | undefined {
    return this.artboards.find(a => a.id === id);
  }

  /** Create a frame (world coords). Returns the new frame shape's id. */
  addFrame(x: number, y: number, w: number, h: number, name: string): string {
    const g = this.createFrameElement(x, y, w, h, name);
    // A frame drawn inside another frame nests within it (searched BEFORE g is in
    // the DOM, so it can't match itself); its transform becomes container-local.
    const container = this.frameAtPoint(x + w / 2, y + h / 2);
    if (container) {
      const o = this.frameWorldOrigin(container.element);
      g.setAttribute('transform', `translate(${x - o.x} ${y - o.y})`);
      container.element.appendChild(g);
    } else {
      this.drawingLayer.appendChild(g);
    }
    this.rebuildShapesFromDOM();
    // Only TOP-LEVEL frames act as artboards; a nested frame is a clipped container.
    if (!container) this.activeFrameId = g.id;
    this.selectedShapeIds = [g.id];
    this.saveHistory();
    this.onChangeCallback();
    return g.id;
  }

  /** Create a frame from an Artboard-shaped request (the Frame tool's adapter);
   *  returns the new frame's id. addFrame mints its own shape-N id, so the
   *  request's `id` is ignored. */
  addArtboard(ab: Artboard): string {
    return this.addFrame(ab.x, ab.y, ab.width, ab.height, ab.name);
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
      // Only top-level shapes and direct frame-children participate in frame
      // auto-parenting. A shape nested in a group / clip-group / boolean / etc.
      // belongs to that container — reparenting it to a frame would rip it out of
      // its group (and, since its bbox is container-local, at a wrong position).
      const curFrameEl = curParent?.hasAttribute?.('data-frame') ? curParent : null;
      if (curParent !== this.drawingLayer && !curFrameEl) continue;
      const curOff = curFrameEl ? this.frameWorldOrigin(curFrameEl) : { x: 0, y: 0 };
      let bbox: DOMRect;
      try { bbox = (el as unknown as SVGGraphicsElement).getBBox(); } catch { continue; }
      const cx = curOff.x + bbox.x + bbox.width / 2;
      const cy = curOff.y + bbox.y + bbox.height / 2;
      const targetFrame = this.frameAtPoint(cx, cy);
      const targetEl: SVGElement = targetFrame ? (targetFrame.element as SVGElement) : this.drawingLayer;
      if (targetEl === curParent) continue; // unchanged
      const tOff = targetFrame ? this.frameWorldOrigin(targetFrame.element) : { x: 0, y: 0 };
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
    this.activeFrameId = newId;
    this.selectedFrameId = newId;
    this.selectedShapeIds = [newId];
    this.saveHistory();
    this.onChangeCallback();
  }

  removeArtboard(id: string): void {
    if (this.shapes.filter(s => s.type === 'frame').length <= 1) return; // keep ≥1
    if (!this.detachShape(id)) return;
    if (this.selectedFrameId === id) this.selectedFrameId = null;
    this.rebuildShapesFromDOM();
    this.saveHistory();
    this.onChangeCallback();
  }

  updateArtboard(id: string, updates: Partial<Omit<Artboard, 'id'>>, opts: { keepChildrenFixed?: boolean } = {}): void {
    const s = this.frameShapeById(id);
    if (!s) return;
    const el = s.element;
    const cur = this.frameToArtboard(s);
    if (updates.name != null) { el.setAttribute('data-name', updates.name); s.name = updates.name; }
    const nx = updates.x ?? cur.x, ny = updates.y ?? cur.y;
    if (updates.x != null || updates.y != null) {
      // When resizing from the top/left, the origin moves but content should stay
      // world-fixed — compensate the child geometry by the inverse origin delta.
      // (For a plain move, keepChildrenFixed is false so content travels with the frame.)
      if (opts.keepChildrenFixed) {
        const ddx = nx - cur.x, ddy = ny - cur.y;
        if (ddx || ddy) {
          for (const child of Array.from(el.children) as SVGElement[]) {
            if (child.tagName.toLowerCase() === 'clippath' || child.classList.contains('frame-bg')) continue;
            this.offsetElement(child, -ddx, -ddy);
          }
        }
      }
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
    this.activeFrameId = id;
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
      const a = this.frameWorldOrigin(frame.element); // accumulates nested frames
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

  // Layer-panel operations are owned by LayerManager; these delegate.
  toggleVisibility(id: string): void { this.layerMgr.toggleVisibility(id); }
  toggleLock(id: string): void { this.layerMgr.toggleLock(id); }
  showAll(): void { this.layerMgr.showAll(); }
  unlockAll(): void { this.layerMgr.unlockAll(); }
  moveShapeUp(id: string): void { this.layerMgr.moveShapeUp(id); }
  moveShapeDown(id: string): void { this.layerMgr.moveShapeDown(id); }
  moveShape(draggedId: string, targetId: string, position: 'before' | 'after' | 'inside'): boolean { return this.layerMgr.moveShape(draggedId, targetId, position); }
  groupShapes(draggedId: string, targetId: string): boolean { return this.layerMgr.groupShapes(draggedId, targetId); }
  bringToFront(): void { this.layerMgr.bringToFront(); }
  sendToBack(): void { this.layerMgr.sendToBack(); }
  duplicateShape(id: string): void { this.layerMgr.duplicateShape(id); }
  duplicateSelected(): void { this.layerMgr.duplicateSelected(); }
  notifyMovedSelection(dx: number, dy: number): void { this.layerMgr.notifyMovedSelection(dx, dy); }

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
      if (active?.type === 'boolean') this.pathfinder.recompute(active.element);
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

  /** Snapshot / restore the whole undo stack (used by the document tab manager to
   *  cache each tab's history). */
  exportHistory(): HistorySnapshot { return this.historyMgr.exportState(); }
  importHistory(s: HistorySnapshot): void { this.historyMgr.restoreState(s); }

  /** True when there are edits since the last save/open/new. */
  get dirty(): boolean { return this.historyMgr.dirty; }

  /** Document-version token; changes on every edit. Snapshot before an async save
   *  and compare after, so markClean only runs if nothing changed mid-await. */
  get revision(): number { return this.historyMgr.revision; }

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
    this.effects.ensureFilters();
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
      if (el.hasAttribute('data-appearance')) return 'appearance';
      if (el.hasAttribute('data-width')) return 'width';
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
    if (type === 'group' || type === 'image' || type === 'use' || type === 'boolean' || type === 'appearance' || type === 'width') {
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
    // Gather selected shapes wherever they live (inside a frame/group or top level).
    const toGroup = this.selectedInDomOrder();
    if (toGroup.length < 2) return;

    const parent = this.commonParentOf(toGroup);
    const gEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const groupId = this.nextId();
    gEl.id = groupId;
    gEl.setAttribute('data-name', `Group ${groupId.replace('shape-', '#')}`);

    // Insert the group into the operands' parent, then move them in (coords keep,
    // wrapper has no transform in the same parent space).
    const insertBefore = toGroup[toGroup.length - 1].element.nextSibling as SVGElement | null;
    parent.insertBefore(gEl, insertBefore);
    for (const s of toGroup) gEl.appendChild(s.element);

    this.rebuildShapesFromDOM();
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
  // Pathfinder / boolean / shape-builder / outline / offset are owned by
  // PathfinderManager; these delegate. selectedInDomOrder / commonParentOf /
  // convertShapeToPath stay here (grouping & clipping use them too) and are
  // surfaced to the manager through its host.
  booleanSelection(op: BooleanOp, reverse = false): Promise<boolean> { return this.pathfinder.booleanSelection(op, reverse); }
  previewSelectionBoolean(op: BooleanOp, reverse = false): string[] { return this.pathfinder.previewSelectionBoolean(op, reverse); }
  selectionFaces(): Promise<{ faces: string[]; ids: string[] } | null> { return this.pathfinder.selectionFaces(); }
  replaceShapesWithPaths(originalIds: string[], resultDs: string[], fill: string): void { this.pathfinder.replaceShapesWithPaths(originalIds, resultDs, fill); }
  flattenBoolean(id: string): void { this.pathfinder.flatten(id); }
  outlineSelectedStroke(): Promise<boolean> { return this.pathfinder.outlineSelectedStroke(); }
  offsetSelectedPath(delta: number): Promise<boolean> { return this.pathfinder.offsetSelectedPath(delta); }

  /** Selected shapes resolved anywhere in the tree, sorted bottom→top (DOM order). */
  private selectedInDomOrder(): ShapeData[] {
    const shapes = this.selectedShapeIds
      .map(id => this.findShapeById(id))
      .filter((s): s is ShapeData => !!s);
    shapes.sort((a, b) =>
      (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    return shapes;
  }

  /** The element all shapes share as a direct parent, else the drawing layer. */
  private commonParentOf(shapes: ShapeData[]): SVGElement {
    const first = shapes[0]?.element.parentElement ?? null;
    if (first && shapes.every(s => s.element.parentElement === first)) {
      return first as unknown as SVGElement;
    }
    return this.drawingLayer;
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
    const members = this.selectedInDomOrder(); // anywhere in the tree, bottom→top
    if (members.length < 2) return false;

    const clip = members[members.length - 1]; // topmost = the mask
    const clipped = members.slice(0, -1);
    const parent = this.commonParentOf(members);

    const SVG = 'http://www.w3.org/2000/svg';
    const gEl = document.createElementNS(SVG, 'g');
    const groupId = this.nextId();
    gEl.id = groupId;
    gEl.setAttribute('data-name', `Clip Group ${groupId.replace('shape-', '#')}`);
    gEl.setAttribute('data-clip-group', '');
    const clipId = `clipmask-${groupId.replace('shape-', '')}`;
    gEl.setAttribute('clip-path', `url(#${clipId})`);

    // Insert the group into the operands' parent first (so moving members in keeps
    // their coordinate space), then assemble.
    parent.insertBefore(gEl, clip.element.nextSibling);
    const clipPathEl = document.createElementNS(SVG, 'clipPath');
    clipPathEl.setAttribute('id', clipId);
    clipPathEl.appendChild(clip.element); // topmost object becomes the mask
    gEl.appendChild(clipPathEl);
    for (const s of clipped) gEl.appendChild(s.element);

    this.rebuildShapesFromDOM();
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

  // ---- Appearance stack (multiple fills / strokes on one object) ------------
  //
  // Illustrator's Appearance panel: an object can carry several fills and strokes
  // stacked in z-order, each with its own paint / opacity / (stroke) width / blend.
  // SVG paints a single element with one fill + one stroke, so a rich stack is
  // stored as a `<g data-appearance="[layers]">` wrapper. Inside it:
  //   • one hidden `[data-ap-src]` element  → the canonical geometry (the object
  //     the user actually drew: rect / path / text / …), fill+stroke cleared;
  //   • N `[data-ap]` render-clones of that geometry, one per visible layer, each
  //     painted with a single fill or stroke, stacked bottom→top.
  // The render-clones live in the drawing layer, so they round-trip through the
  // history/innerHTML snapshot for free; rebuildShapesFromDOM models the wrapper
  // as a LEAF (type 'appearance') and never walks into it, so the clones never
  // become phantom layers. When a stack collapses to ≤1 fill and ≤1 stroke we
  // UNWRAP back to a plain native element, so ordinary shapes stay fully editable
  // (node tool, path ops) and only genuinely-stacked objects become leaves.

  // Appearance stacks are owned by AppearanceManager; these delegate.
  getAppearance(id: string): AppearanceLayer[] { return this.appearanceMgr.get(id); }
  setAppearance(id: string, layers: AppearanceLayer[], record = true): void { this.appearanceMgr.set(id, layers, record); }

  // ---- Variable-width strokes (the Width tool) ------------------------------
  //
  // A stroke whose thickness varies along its length. SVG can't paint that, so a
  // width object is a `<g data-width>` wrapper (leaf, type 'width') holding:
  //   • `[data-width-src]`   — the centerline geometry (keeps the object's fill,
  //     stroke cleared) — the editable source, and
  //   • `[data-width-render]`— a generated closed outline `<path>` filled with the
  //     stroke colour, whose shape comes from the centerline + width profile.
  // The outline lives in the drawing layer, so it round-trips through the history/
  // innerHTML snapshot for free; rebuildShapesFromDOM treats the wrapper as a leaf
  // and never walks into it. The profile (data-width-profile) + base width + stroke
  // colour live on the wrapper, so a plain re-render needs nothing but the snapshot;
  // regeneration only runs when the profile changes (preset, or a Width-tool drag).

  // Variable-width strokes are owned by WidthStrokeManager; these delegate.
  getWidthProfile(id: string): { centerline: string; base: number; stroke: string; points: WidthPoint[] } | null { return this.widthMgr.get(id); }
  canApplyWidth(id: string): boolean { return this.widthMgr.canApply(id); }
  clearWidthProfile(id: string): void { this.widthMgr.clear(id); }
  setWidthProfile(id: string, points: WidthPoint[], base: number, record = true): void { this.widthMgr.set(id, points, base, record); }

  // ---- Type on a path ----

  /** True when the selection is exactly one text + one path (enables the command). */
  canTypeOnPath(): boolean {
    const sel = this.selectedShapeIds.map(id => this.findShapeById(id)).filter((s): s is ShapeData => !!s);
    return sel.length === 2 && sel.some(s => s.type === 'text') && sel.some(s => s.type === 'path');
  }

  /**
   * Flow the selected text along the selected path (Illustrator's Type on a Path).
   * The text's content is wrapped in a `<textPath href="#pathId">`; the path stays
   * a real sibling (so the reference round-trips) but its paint is cleared so it
   * acts as an invisible baseline. Re-editing (text tool) updates the textPath.
   */
  typeTextOnPath(): boolean {
    const sel = this.selectedShapeIds.map(id => this.findShapeById(id)).filter((s): s is ShapeData => !!s);
    const text = sel.find(s => s.type === 'text');
    const path = sel.find(s => s.type === 'path');
    if (!text || !path) return false;
    const pathId = path.element.id;
    const content = text.element.textContent ?? '';

    while (text.element.firstChild) text.element.removeChild(text.element.firstChild);
    const tp = document.createElementNS('http://www.w3.org/2000/svg', 'textPath');
    tp.setAttribute('href', `#${pathId}`);
    tp.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${pathId}`); // legacy renderers
    tp.textContent = content;
    text.element.appendChild(tp);
    // textPath positions along the path, so the text's own x/y no longer apply.
    text.element.removeAttribute('x');
    text.element.removeAttribute('y');
    text.element.setAttribute('data-textpath', pathId);
    // The path becomes an invisible baseline (kept for the reference + re-editing).
    path.element.setAttribute('fill', 'none');
    path.element.setAttribute('stroke', 'none');

    this.selectedShapeIds = [text.id];
    this.saveHistory();
    this.onChangeCallback();
    return true;
  }

  // ---- Effects (blur / drop shadow via SVG filters) ----
  //
  // Effect parameters are the source of truth and live as data-fx-* attributes on
  // the element, so they round-trip through the history/innerHTML snapshot. The
  // SVG <filter> in <defs> is a regenerated CACHE (defs aren't snapshotted), so
  // EffectsManager.ensureFilters() rebuilds it after every rebuildShapesFromDOM/import.

  // Effects (blur / drop shadow) are owned by EffectsManager; these delegate.
  getObjectEffects(id: string): { blur: number; shadow: ObjectShadow | null } {
    return this.effects.getObjectEffects(id);
  }

  /** Elements of the current selection (resolved anywhere in the tree). */
  private selectionElements(): SVGElement[] {
    return this.selectedShapeIds
      .map(id => this.findShapeById(id)?.element)
      .filter((el): el is SVGElement => !!el);
  }

  /** Apply a fill paint to every selected object in one undo step (used by the
   *  Swatches panel; also the multi-select fill the color picker lacked). */
  setSelectionFill(value: string): void {
    this.defaultStyle.fill = value;
    this.fillNone = value === 'none';
    for (const el of this.selectionElements()) el.setAttribute('fill', value);
    this.saveHistory();
    this.onChangeCallback();
  }

  /** Apply a stroke paint to every selected object in one undo step. */
  setSelectionStroke(value: string): void {
    this.defaultStyle.stroke = value;
    this.strokeNone = value === 'none';
    for (const el of this.selectionElements()) el.setAttribute('stroke', value);
    this.saveHistory();
    this.onChangeCallback();
  }

  setObjectBlur(id: string, stdDev: number, record = true): void { this.effects.setObjectBlur(id, stdDev, record); }
  setObjectShadow(id: string, shadow: ObjectShadow | null, record = true): void { this.effects.setObjectShadow(id, shadow, record); }
  setSelectionBlur(stdDev: number, record = true): void { this.effects.setSelectionBlur(stdDev, record); }
  setSelectionShadow(shadow: ObjectShadow | null, record = true): void { this.effects.setSelectionShadow(shadow, record); }

  // ---- Markers (arrowheads / dots on line & path ends) ----
  //
  // The marker-start/marker-end presentation attributes round-trip through the
  // history snapshot; the shared <marker> library lives in <defs> and is rebuilt
  // by ensureMarkerDefs() (defs aren't snapshotted). fill="context-stroke" makes
  // each arrowhead match its path's stroke colour.

  // Markers (arrowheads) are owned by MarkersManager; these delegate.
  ensureMarkerDefs(): void { this.markers.ensureDefs(); }
  getMarkers(id: string): { start: string; end: string } { return this.markers.get(id); }
  setMarker(id: string, pos: 'start' | 'end', markerId: string | null): void { this.markers.set(id, pos, markerId); }
  setSelectionMarker(pos: 'start' | 'end', markerId: string | null): void { this.markers.setSelection(pos, markerId); }

  /** Blend mode (mix-blend-mode) of an object; 'normal' = none. Stored as inline
   *  style, which round-trips through the history/innerHTML snapshot. */
  getBlendMode(id: string): string {
    const el = this.findShapeById(id)?.element as SVGElement | undefined;
    return el?.style.mixBlendMode || 'normal';
  }

  private applyBlendTo(el: SVGElement, mode: string): void {
    if (mode && mode !== 'normal') el.style.mixBlendMode = mode;
    else el.style.removeProperty('mix-blend-mode');
    if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
  }

  setBlendMode(id: string, mode: string): void {
    const el = this.findShapeById(id)?.element as SVGElement | undefined;
    if (!el) return;
    this.applyBlendTo(el, mode);
    this.saveHistory();
    this.onChangeCallback();
  }

  /** Apply a blend mode to every selected object in a single undo step. */
  setSelectionBlendMode(mode: string): void {
    for (const el of this.selectionElements()) this.applyBlendTo(el, mode);
    this.saveHistory();
    this.onChangeCallback();
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
    // A blank document starts with a default frame (like the constructor).
    this.drawingLayer.appendChild(this.createFrameElement(0, 0, 960, 540, 'Frame 1'));
    this.rebuildShapesFromDOM();
    this.activeFrameId = this.artboards[0]?.id ?? null;
    this.selectedFrameId = null;
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
