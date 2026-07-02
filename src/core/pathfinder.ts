// ---------------------------------------------------------------------------
// Pathfinder — boolean compound shapes + Shape Builder + Outline Stroke / Offset
// Path. All the orchestration around the Paper.js engine (core/boolean.ts): it
// collects operands from the selection, runs the op, and builds the result into
// the shape tree.
//
// The single-output booleans build a LIVE `<g data-boolean>` whose operands stay
// editable and whose cached `[data-bool-result]` path recomputes on edit (and on
// history restore). Extracted from AppState as a collaborator; it reaches the shape
// tree only through PathfinderHost. A few genuinely-shared tree helpers
// (selectedInDomOrder / commonParentOf / convertShapeToPath) stay in AppState
// (grouping and clipping use them too) and are surfaced through the host.
// ---------------------------------------------------------------------------

import type { ShapeData } from './types';
import {
  type BooleanOp, type StrokeJoin, type StrokeCap,
  ensureBooleanEngine, booleanEngineReady, computeBoolean, elementPathData,
  localPathData, ensureOffsetEngine, offsetPathData, outlineStrokeData,
} from './boolean';

const SVG = 'http://www.w3.org/2000/svg';
const PATHABLE: ReadonlyArray<ShapeData['type']> =
  ['path', 'rect', 'ellipse', 'line', 'polyline', 'polygon'];

export interface PathfinderHost {
  getShapes(): ShapeData[];
  getSelectedIds(): string[];
  setSelection(ids: string[]): void;
  getDrawingLayer(): SVGGElement;
  findShape(id: string): ShapeData | null;
  nextId(): string;
  /** Selected shapes resolved anywhere in the tree, bottom→top (DOM order). */
  selectedInDomOrder(): ShapeData[];
  /** The element all shapes share as a direct parent, else the drawing layer. */
  commonParentOf(shapes: ShapeData[]): SVGElement;
  /** Replace a primitive with an equivalent <path> in place; false if not convertible. */
  convertShapeToPath(shape: ShapeData): boolean;
  detachShape(id: string): boolean;
  exitGroupIsolation(): void;
  rebuild(): void;
  saveHistory(): void;
  onChange(): void;
}

export class PathfinderManager {
  private host: PathfinderHost;
  constructor(host: PathfinderHost) { this.host = host; }

  /**
   * Combine the current selection with a Pathfinder op. The four single-output ops
   * build a LIVE `<g data-boolean>` whose operands stay editable and whose cached
   * result path recomputes on edit. `divide` produces a plain group of the disjoint
   * pieces. Operands are taken in document order (bottom→top z), which defines
   * subtract. Returns false when fewer than two shapes are selected or the result
   * is empty.
   */
  async booleanSelection(op: BooleanOp, reverse = false): Promise<boolean> {
    let operands = this.host.selectedInDomOrder();
    if (operands.length < 2) return false;
    if (reverse) operands.reverse(); // Subtract "swap": flip which shape is the cutter.

    await ensureBooleanEngine();

    // Operate in the operands' COMMON PARENT space, so the result lands in the same
    // container (e.g. the frame) with correct coordinates.
    const parent = this.host.commonParentOf(operands);
    const operandDs = this.operandDsInParentSpace(operands, parent);
    if (!operandDs) return false;
    const resultDs = computeBoolean(operandDs, op);
    if (resultDs.length === 0 || resultDs.every((d) => !d.trim())) return false;

    const insertBefore = operands[operands.length - 1].element.nextSibling as SVGElement | null;
    const newId = op === 'divide'
      ? this.buildDivideGroup(operands, resultDs, parent, insertBefore)
      : this.buildBooleanShape(op, operands, resultDs[0], parent, insertBefore);

    this.host.rebuild(); // resync (operands may have been nested)
    this.host.setSelection([newId]);
    this.host.saveHistory();
    this.host.onChange();
    return true;
  }

  /** Operand geometry as `d` strings in a target parent's local space. */
  private operandDsInParentSpace(operands: ShapeData[], parentEl: SVGElement): string[] | null {
    const pctm = (parentEl as unknown as SVGGraphicsElement).getScreenCTM();
    if (!pctm) return null;
    const inv = pctm.inverse();
    return operands.map((s) => {
      const ctm = (s.element as unknown as SVGGraphicsElement).getScreenCTM();
      return ctm ? elementPathData(s.element, inv.multiply(ctm)) : '';
    });
  }

  /** Operand geometry in drawing-layer (world) space — for the hover preview ghost. */
  private operandDsInLayerSpace(operands: ShapeData[]): string[] | null {
    return this.operandDsInParentSpace(operands, this.host.getDrawingLayer());
  }

  /**
   * Non-mutating preview of a boolean over the current selection, in drawing-layer
   * space — used by the Pathfinder panel to ghost the result on hover. Synchronous;
   * returns [] if the engine isn't loaded yet or fewer than two shapes are selected.
   */
  previewSelectionBoolean(op: BooleanOp, reverse = false): string[] {
    if (!booleanEngineReady()) return [];
    const sel = this.host.getSelectedIds();
    const operands = this.host.getShapes().filter((s) => sel.includes(s.id));
    if (operands.length < 2) return [];
    if (reverse) operands.reverse();
    const operandDs = this.operandDsInLayerSpace(operands);
    if (!operandDs) return [];
    return computeBoolean(operandDs, op);
  }

  /**
   * Decompose the current selection into its arrangement faces (the atomic regions
   * of the overlapping shapes), in drawing-layer space. Used by the Shape Builder
   * tool. Returns null if fewer than two shapes are selected.
   */
  async selectionFaces(): Promise<{ faces: string[]; ids: string[] } | null> {
    const sel = this.host.getSelectedIds();
    const operands = this.host.getShapes().filter((s) =>
      sel.includes(s.id) &&
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
   * result paths (already in drawing-layer space), each filled with `fill`. Selects
   * the results.
   */
  replaceShapesWithPaths(originalIds: string[], resultDs: string[], fill: string): void {
    for (const id of originalIds) this.host.detachShape(id); // remove without per-shape history

    const newIds: string[] = [];
    for (const d of resultDs) {
      if (!d.trim()) continue;
      const el = document.createElementNS(SVG, 'path');
      const id = this.host.nextId();
      el.id = id;
      el.setAttribute('d', d);
      el.setAttribute('fill', fill);
      el.setAttribute('fill-rule', 'evenodd');
      el.setAttribute('data-name', `Shape ${id.replace('shape-', '#')}`);
      this.host.getDrawingLayer().appendChild(el);
      newIds.push(id);
    }
    this.host.setSelection(newIds);
    this.host.rebuild();
    this.host.setSelection(newIds);
    this.host.saveHistory();
    this.host.onChange();
  }

  /** Assemble the live `<g data-boolean>` wrapper from operand shapes. */
  private buildBooleanShape(
    op: BooleanOp, operands: ShapeData[], resultD: string, parent: SVGElement, insertBefore: SVGElement | null,
  ): string {
    const gEl = document.createElementNS(SVG, 'g');
    const id = this.host.nextId();
    gEl.id = id;
    gEl.setAttribute('data-name', `${op[0].toUpperCase()}${op.slice(1)} ${id.replace('shape-', '#')}`);
    gEl.setAttribute('data-boolean', op);
    gEl.setAttribute('fill-rule', 'evenodd');
    // Result paint comes from the wrapper, seeded from the bottom operand.
    const base = operands[0].element;
    for (const attr of ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity']) {
      const v = base.getAttribute(attr);
      if (v != null) gEl.setAttribute(attr, v);
    }
    parent.insertBefore(gEl, insertBefore);
    for (const s of operands) {
      s.element.setAttribute('data-bool-operand', '');
      gEl.appendChild(s.element);
    }
    const resultEl = document.createElementNS(SVG, 'path');
    resultEl.setAttribute('data-bool-result', '');
    resultEl.setAttribute('d', resultD);
    gEl.appendChild(resultEl);
    return id;
  }

  /** Divide: replace operands with a plain group of the disjoint region paths. */
  private buildDivideGroup(
    operands: ShapeData[], pieceDs: string[], parent: SVGElement, insertBefore: SVGElement | null,
  ): string {
    const gEl = document.createElementNS(SVG, 'g');
    const id = this.host.nextId();
    gEl.id = id;
    gEl.setAttribute('data-name', `Divide ${id.replace('shape-', '#')}`);
    const fill = operands[0].element.getAttribute('fill') ?? '#cccccc';

    for (const d of pieceDs) {
      if (!d.trim()) continue;
      const pEl = document.createElementNS(SVG, 'path');
      const pid = this.host.nextId();
      pEl.id = pid;
      pEl.setAttribute('d', d);
      pEl.setAttribute('fill', fill);
      pEl.setAttribute('fill-rule', 'evenodd');
      pEl.setAttribute('data-name', `Piece ${pid.replace('shape-', '#')}`);
      gEl.appendChild(pEl);
    }
    for (const s of operands) s.element.remove(); // consumed by Divide
    parent.insertBefore(gEl, insertBefore);
    return id;
  }

  /**
   * Regenerate a live boolean's cached result path from its current operands.
   * Operands are read in the wrapper's local space. No-op if the engine isn't loaded
   * or operands aren't currently rendered (so it never clobbers with stale data).
   */
  recompute(wrapperEl: SVGElement): void {
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
  flatten(id: string): void {
    const shape = this.host.findShape(id);
    if (!shape || shape.type !== 'boolean') return;
    const wrapper = shape.element;
    if (booleanEngineReady()) this.recompute(wrapper);
    const result = wrapper.querySelector('[data-bool-result]');
    const d = result?.getAttribute('d') ?? '';
    const path = document.createElementNS(SVG, 'path');
    path.id = id;
    path.setAttribute('d', d);
    for (const attr of ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-rule', 'fill-opacity', 'stroke-opacity', 'data-name']) {
      const v = wrapper.getAttribute(attr);
      if (v != null) path.setAttribute(attr, v);
    }
    this.host.exitGroupIsolation();
    wrapper.replaceWith(path);
    this.host.rebuild();
    this.host.setSelection([id]);
    this.host.saveHistory();
    this.host.onChange();
  }

  /**
   * Convert the stroke of each selected stroked object into a filled outline path
   * (Illustrator's Outline Stroke). Returns false if nothing had an outline-able
   * stroke.
   */
  async outlineSelectedStroke(): Promise<boolean> {
    const targets = this.host.getSelectedIds()
      .map(id => this.host.findShape(id))
      .filter((s): s is ShapeData => !!s && PATHABLE.includes(s.type))
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
    this.host.rebuild();
    if (resultIds.length) this.host.setSelection(resultIds);
    this.host.saveHistory();
    this.host.onChange();
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
    const gid = this.host.nextId();
    g.id = gid;
    g.setAttribute('data-name', 'Outlined Stroke');
    outline.id = this.host.nextId();
    el.replaceWith(g);
    g.appendChild(el);
    g.appendChild(outline);
    return gid;
  }

  /**
   * Offset every selected path outward (positive) or inward (negative) by `delta`,
   * in place, preserving curves. Primitives are converted to paths first. Returns
   * false if nothing changed.
   */
  async offsetSelectedPath(delta: number): Promise<boolean> {
    if (!delta) return false;
    const shapes = this.host.getSelectedIds()
      .map(id => this.host.findShape(id))
      .filter((s): s is ShapeData => !!s && PATHABLE.includes(s.type));
    if (shapes.length === 0) return false;

    await ensureOffsetEngine();
    let changed = false;
    for (const s of shapes) {
      if (s.type !== 'path' && !this.host.convertShapeToPath(s)) continue;
      const d = s.element.getAttribute('d') ?? '';
      const out = offsetPathData(d, delta, 'miter');
      if (out.trim()) { s.element.setAttribute('d', out); changed = true; }
    }
    if (!changed) return false;
    this.host.saveHistory();
    this.host.onChange();
    return true;
  }
}
