// ---------------------------------------------------------------------------
// Smart guides / snapping for drag-move and resize.
//
// Pure geometry helpers plus guide-line rendering. Targets are collected once
// at the start of a gesture (the artboard and the non-moving objects don't move
// while you drag), then each mousemove only does cheap nearest-line lookups.
//
// All coordinates are in drawing-layer (canvas/SVG user) space — the same space
// the select tool already works in — so no screen<->canvas conversion is needed
// here. Thresholds are passed in already converted to canvas units.
// ---------------------------------------------------------------------------

import type { AppState } from './state';
import type { BBox } from './types';

const NS = 'http://www.w3.org/2000/svg';
const EPS = 0.01;

/** Snap zone in screen pixels. Callers divide by zoom to get canvas units. */
export const SNAP_PX = 6;

/** A candidate snap line. `pos` is the coordinate on the snap axis (X for a
 *  vertical line, Y for a horizontal line); `min`/`max` is the line's extent on
 *  the perpendicular axis, used to size the drawn guide. */
export interface SnapLine { pos: number; min: number; max: number }

/** Vertical lines snap the X axis; horizontal lines snap the Y axis. */
export interface SnapTargets { vertical: SnapLine[]; horizontal: SnapLine[] }

export interface GuideLine { x1: number; y1: number; x2: number; y2: number }

/** Axis-aligned bbox of an element in drawing-layer space (mirrors
 *  SelectTool.getScreenSpaceBBox for a single element). Returns null if the
 *  element has no renderable geometry. */
export function getAABB(el: SVGGraphicsElement, svgCanvas: SVGSVGElement): BBox | null {
  const drawingLayer = svgCanvas.querySelector('#drawing-layer') as SVGGraphicsElement | null;
  const parentCtm = drawingLayer?.getCTM?.();
  try {
    const bbox = el.getBBox();
    const ctm = el.getCTM();
    if (ctm && parentCtm) {
      const m = parentCtm.inverse().multiply(ctm);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of [
        { x: bbox.x, y: bbox.y },
        { x: bbox.x + bbox.width, y: bbox.y },
        { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
        { x: bbox.x, y: bbox.y + bbox.height },
      ]) {
        const pt = svgCanvas.createSVGPoint();
        pt.x = c.x; pt.y = c.y;
        const t = pt.matrixTransform(m);
        minX = Math.min(minX, t.x); minY = Math.min(minY, t.y);
        maxX = Math.max(maxX, t.x); maxY = Math.max(maxY, t.y);
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
  } catch {
    return null;
  }
}

/** Push the left/center/right (vertical) and top/middle/bottom (horizontal)
 *  snap lines of an axis-aligned box. */
function addBoxTargets(targets: SnapTargets, x: number, y: number, w: number, h: number): void {
  if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) return;
  const top = y, bottom = y + h, left = x, right = x + w;
  targets.vertical.push(
    { pos: left, min: top, max: bottom },
    { pos: x + w / 2, min: top, max: bottom },
    { pos: right, min: top, max: bottom },
  );
  targets.horizontal.push(
    { pos: top, min: left, max: right },
    { pos: y + h / 2, min: left, max: right },
    { pos: bottom, min: left, max: right },
  );
}

/** Collect every snap line for the current gesture: the active artboard's
 *  edges + center, and the edges + center of all other (non-moving, visible,
 *  unlocked) top-level shapes. `movingIds` are the shapes being dragged/resized
 *  (excluded so they don't snap to themselves). */
export function collectSnapTargets(
  state: AppState,
  movingIds: Set<string>,
  svgCanvas: SVGSVGElement,
): SnapTargets {
  const targets: SnapTargets = { vertical: [], horizontal: [] };

  const ab = state.getActiveArtboard();
  if (ab) addBoxTargets(targets, ab.x, ab.y, ab.width, ab.height);

  for (const shape of state.shapes) {
    if (movingIds.has(shape.id) || !shape.visible || shape.locked) continue;
    const aabb = getAABB(shape.element as unknown as SVGGraphicsElement, svgCanvas);
    if (aabb) addBoxTargets(targets, aabb.x, aabb.y, aabb.width, aabb.height);
  }
  return targets;
}

/** Best (closest within threshold) snap of any candidate to any line. */
function bestSnap(
  candidates: number[],
  lines: SnapLine[],
  threshold: number,
): { delta: number; pos: number } | null {
  let best: { delta: number; pos: number } | null = null;
  for (const c of candidates) {
    for (const line of lines) {
      const dist = line.pos - c;
      if (Math.abs(dist) <= threshold && (!best || Math.abs(dist) < Math.abs(best.delta))) {
        best = { delta: dist, pos: line.pos };
      }
    }
  }
  return best;
}

/** Guides for every target line sitting exactly on a chosen snapped position,
 *  extended to also span the moving box. */
function guidesAt(
  lines: SnapLine[], pos: number, vertical: boolean,
  boxMin: number, boxMax: number,
): GuideLine[] {
  const out: GuideLine[] = [];
  for (const line of lines) {
    if (Math.abs(line.pos - pos) > EPS) continue;
    const a = Math.min(line.min, boxMin), b = Math.max(line.max, boxMax);
    out.push(vertical
      ? { x1: pos, y1: a, x2: pos, y2: b }
      : { x1: a, y1: pos, x2: b, y2: pos });
  }
  return out;
}

/** Snap a dragged box. Returns the position adjustment (`dx`/`dy`, 0 per axis
 *  when nothing is within range) and the guides to draw. */
export function computeSnap(
  moving: BBox,
  targets: SnapTargets,
  threshold: number,
): { dx: number; dy: number; guides: GuideLine[] } {
  const xs = [moving.x, moving.x + moving.width / 2, moving.x + moving.width];
  const ys = [moving.y, moving.y + moving.height / 2, moving.y + moving.height];

  const sx = bestSnap(xs, targets.vertical, threshold);
  const sy = bestSnap(ys, targets.horizontal, threshold);
  const dx = sx ? sx.delta : 0;
  const dy = sy ? sy.delta : 0;

  const nx = moving.x + dx, ny = moving.y + dy;
  const guides: GuideLine[] = [];
  if (sx) guides.push(...guidesAt(targets.vertical, sx.pos, true, ny, ny + moving.height));
  if (sy) guides.push(...guidesAt(targets.horizontal, sy.pos, false, nx, nx + moving.width));
  return { dx, dy, guides };
}

/** Snap the moving edge(s) of a resize. `handle` is one of nw/n/ne/e/se/s/sw/w;
 *  the letters say which edges move. Returns adjusted `dx`/`dy` and guides. */
export function computeResizeSnap(
  origBBox: BBox,
  dx: number,
  dy: number,
  handle: string,
  targets: SnapTargets,
  threshold: number,
): { dx: number; dy: number; guides: GuideLine[] } {
  const left = origBBox.x, right = origBBox.x + origBBox.width;
  const top = origBBox.y, bottom = origBBox.y + origBBox.height;

  // Candidate moving edges in their current (dragged) position.
  const xEdges: number[] = [];
  if (handle.includes('w')) xEdges.push(left + dx);
  if (handle.includes('e')) xEdges.push(right + dx);
  const yEdges: number[] = [];
  if (handle.includes('n')) yEdges.push(top + dy);
  if (handle.includes('s')) yEdges.push(bottom + dy);

  const sx = bestSnap(xEdges, targets.vertical, threshold);
  const sy = bestSnap(yEdges, targets.horizontal, threshold);
  if (sx) dx += sx.delta;
  if (sy) dy += sy.delta;

  // Resized box (mirrors applyResize) for guide extents.
  let nx = origBBox.x, ny = origBBox.y, nw = origBBox.width, nh = origBBox.height;
  if (handle.includes('e')) nw += dx;
  if (handle.includes('w')) { nx += dx; nw -= dx; }
  if (handle.includes('s')) nh += dy;
  if (handle.includes('n')) { ny += dy; nh -= dy; }

  const guides: GuideLine[] = [];
  if (sx) guides.push(...guidesAt(targets.vertical, sx.pos, true, ny, ny + nh));
  if (sy) guides.push(...guidesAt(targets.horizontal, sy.pos, false, nx, nx + nw));
  return { dx, dy, guides };
}

export function drawSnapGuides(guidesLayer: SVGGElement, guides: GuideLine[]): void {
  clearSnapGuides(guidesLayer);
  for (const g of guides) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', String(g.x1));
    line.setAttribute('y1', String(g.y1));
    line.setAttribute('x2', String(g.x2));
    line.setAttribute('y2', String(g.y2));
    line.setAttribute('stroke', '#FF00FF');
    line.setAttribute('stroke-width', '1');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    line.setAttribute('pointer-events', 'none');
    line.setAttribute('data-snap-guide', '');
    guidesLayer.appendChild(line);
  }
}

export function clearSnapGuides(guidesLayer: SVGGElement): void {
  guidesLayer.querySelectorAll('[data-snap-guide]').forEach(el => el.remove());
}
