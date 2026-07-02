import { BaseTool } from './base';
import type { Point } from '../core/types';
import { nearestOnPath, pointAtParam, pathLength, type WidthPoint } from '../core/variable-width';
import { localPathData } from '../core/boolean';

/**
 * Width tool — sculpt a variable-width stroke by dragging on a path (Illustrator's
 * Width Tool). Select or click a strokeable path, then drag anywhere along it: the
 * perpendicular drag distance sets the stroke's half-width at that point, adding a
 * width point (or grabbing a nearby one). Dragging a point's width to ~0 and
 * releasing removes it. The state owns the model (AppState.setWidthProfile); this
 * tool is the gesture + a light handle overlay.
 *
 * A drag applies live (record=false) and commits one undo step on release.
 */
export class WidthTool extends BaseTool {
  name = 'width';
  private id: string | null = null;      // the width object being edited
  private dragging = false;
  private dragT = 0;                       // profile position under the drag
  private readonly HANDLE_HIT = 8;         // px tolerance to grab an existing point
  private readonly PATH_HIT = 10;          // px tolerance to start on the path

  activate(): void {
    this.adoptSelection();
    this.renderHandles();
  }

  deactivate(): void {
    this.clearHandles();
    this.id = null;
    this.dragging = false;
  }

  onMouseDown(pt: Point, _e: MouseEvent): void {
    // Prefer the shape under the cursor; else the current/selected one.
    const hit = this.widthCapableUnder(_e) ?? this.currentId();
    if (!hit) return;
    const shape = this.state.findShapeById(hit);
    if (!shape) return;
    this.id = hit;

    // Hit-test against the centerline WITHOUT mutating — a plain path must not be
    // converted to a width object unless the click actually lands on it.
    const already = shape.type === 'width';
    const existingModel = already ? this.state.getWidthProfile(hit) : null;
    const centerline = already
      ? (existingModel?.centerline ?? '')
      : (shape.type === 'path' ? (shape.element.getAttribute('d') ?? '') : localPathData(shape.element));
    const points: WidthPoint[] = existingModel?.points ?? [];

    const local = this.toLocal(pt, shape.element);
    const near = nearestOnPath(centerline, local);
    if (!near) return;
    const tolLocal = this.PATH_HIT / this.canvas.getZoom();

    // Grab an existing width point if the click is near one; otherwise, if the
    // click is near the path, start a fresh point at that position.
    const existing = this.nearestExistingPoint(points, near.t);
    if (existing && Math.abs(existing.t - near.t) * pathLength(centerline) < this.HANDLE_HIT / this.canvas.getZoom()) {
      this.dragT = existing.t;
    } else if (near.dist <= tolLocal + this.currentMaxHalf(points)) {
      this.dragT = near.t;
    } else {
      return; // click missed the path — nothing wrapped, nothing changed
    }

    // Confirmed hit → NOW wrap the plain shape into a width object if needed.
    if (!this.ensureModel()) return;
    this.dragging = true;
    this.state.interactive = true;
  }

  onMouseMove(pt: Point, _e: MouseEvent): void {
    if (!this.dragging || !this.id) return;
    const model = this.state.getWidthProfile(this.id);
    if (!model) return;
    const local = this.toLocal(pt, this.groupEl());
    const near = nearestOnPath(model.centerline, local);
    if (!near) return;
    // Perpendicular distance from the centerline → half-width; full width = ×2.
    const width = Math.max(0, near.dist * 2);
    const points = this.upsert(model.points, this.dragT, width);
    this.state.setWidthProfile(this.id, points, model.base, false);
    this.renderHandles();
  }

  onMouseUp(_pt: Point, _e: MouseEvent): void {
    if (!this.dragging || !this.id) { this.dragging = false; return; }
    this.dragging = false;
    this.state.interactive = false;
    const model = this.state.getWidthProfile(this.id);
    if (model) {
      // A point dragged to ~0 width is a removal (unless it's the only shaping).
      let points = model.points;
      points = points.filter(p => !(Math.abs(p.t - this.dragT) < 1e-4 && p.w <= 0.05) || points.length <= 1);
      this.state.setWidthProfile(this.id, points, model.base, true);
    }
    this.renderHandles();
  }

  // ---- model helpers ----

  private adoptSelection(): void {
    const id = this.currentId();
    this.id = id;
  }

  private currentId(): string | null {
    if (this.state.selectedShapeIds.length === 1) {
      const only = this.state.selectedShapeIds[0];
      if (this.state.canApplyWidth(only)) return only;
    }
    return this.id && this.state.findShapeById(this.id) ? this.id : null;
  }

  private widthCapableUnder(e: MouseEvent): string | null {
    let el = e.target as SVGElement | null;
    while (el) {
      if (el.id && el.id.startsWith('shape-') && this.state.canApplyWidth(el.id)) return el.id;
      if (el.id === 'drawing-layer') break;
      el = el.parentElement as SVGElement | null;
    }
    return null;
  }

  /** Ensure the current shape has a width model (wrapping a plain path on demand). */
  private ensureModel(): { centerline: string; base: number; stroke: string; points: WidthPoint[] } | null {
    if (!this.id) return null;
    const shape = this.state.findShapeById(this.id);
    if (!shape) return null;
    if (shape.type !== 'width') {
      // Seed a uniform profile from the current stroke width, then read it back.
      const base = shape.style.strokeWidth > 0 ? shape.style.strokeWidth : 4;
      this.state.setWidthProfile(this.id, [], base, false);
    }
    return this.state.getWidthProfile(this.id);
  }

  private groupEl(): SVGElement | null {
    return this.id ? (this.state.findShapeById(this.id)?.element ?? null) : null;
  }

  private nearestExistingPoint(points: WidthPoint[], t: number): WidthPoint | null {
    let best: WidthPoint | null = null, bd = Infinity;
    for (const p of points) { const d = Math.abs(p.t - t); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  private currentMaxHalf(points: WidthPoint[]): number {
    return points.reduce((m, p) => Math.max(m, p.w / 2), 0);
  }

  /** Insert or replace the width point at position `t` (merging near-coincident). */
  private upsert(points: WidthPoint[], t: number, w: number): WidthPoint[] {
    const out = points.filter(p => Math.abs(p.t - t) > 0.02);
    out.push({ t, w });
    return out.sort((a, b) => a.t - b.t);
  }

  // ---- coordinate + overlay ----

  private toLocal(pt: Point, el: SVGElement | null): Point {
    const g = el as unknown as SVGGraphicsElement | null;
    const drawing = this.svgCanvas.querySelector('#drawing-layer') as unknown as SVGGraphicsElement | null;
    const elCtm = g?.getCTM?.();
    const parentCtm = drawing?.getCTM?.();
    if (!elCtm || !parentCtm) return pt;
    const m = parentCtm.inverse().multiply(elCtm);
    const p = this.svgCanvas.createSVGPoint();
    p.x = pt.x; p.y = pt.y;
    const local = p.matrixTransform(m.inverse());
    return { x: local.x, y: local.y };
  }

  private overlay(): SVGGElement | null {
    return this.svgCanvas.querySelector('#selection-layer');
  }

  private clearHandles(): void {
    this.overlay()?.querySelectorAll('.width-handle').forEach(n => n.remove());
  }

  /** Draw a diamond at each width point's two edges, in user (viewBox) space. */
  private renderHandles(): void {
    this.clearHandles();
    const layer = this.overlay();
    if (!layer || !this.id) return;
    const model = this.state.getWidthProfile(this.id);
    const g = this.groupEl();
    if (!model || !g) return;
    const gCtm = (g as unknown as SVGGraphicsElement).getCTM?.();
    const drawing = this.svgCanvas.querySelector('#drawing-layer') as unknown as SVGGraphicsElement | null;
    const parentCtm = drawing?.getCTM?.();
    if (!gCtm || !parentCtm) return;
    const toUser = parentCtm.inverse().multiply(gCtm); // local → user space
    const sp = this.svgCanvas.createSVGPoint();
    const mapUser = (x: number, y: number) => { sp.x = x; sp.y = y; const q = sp.matrixTransform(toUser); return { x: q.x, y: q.y }; };
    const r = 3 / this.canvas.getZoom();

    for (const p of model.points) {
      const at = pointAtParam(model.centerline, p.t);
      if (!at) continue;
      const half = p.w / 2;
      for (const sign of [1, -1]) {
        const u = mapUser(at.x + at.nx * half * sign, at.y + at.ny * half * sign);
        const dia = document.createElementNS(this.NS, 'path');
        dia.setAttribute('class', 'width-handle');
        dia.setAttribute('d', `M ${u.x} ${u.y - r} L ${u.x + r} ${u.y} L ${u.x} ${u.y + r} L ${u.x - r} ${u.y} Z`);
        dia.setAttribute('fill', '#fff');
        dia.setAttribute('stroke', '#20a0ff');
        dia.setAttribute('stroke-width', String(1 / this.canvas.getZoom()));
        dia.setAttribute('pointer-events', 'none');
        layer.appendChild(dia);
      }
    }
  }
}
