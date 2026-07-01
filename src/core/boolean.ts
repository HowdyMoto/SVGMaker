/**
 * Boolean (Pathfinder) engine — Unite / Subtract / Intersect / Exclude / Divide
 * on vector geometry, preserving Bézier curves.
 *
 * The heavy lifting is delegated to Paper.js, which does native curve booleans
 * (a circle minus a circle yields a true crescent, not a faceted polygon). Paper
 * is **dynamically imported on first use** so the editor's initial bundle stays
 * lean and dependency-free; once loaded it is cached and used synchronously.
 *
 * This module is intentionally pure and DOM-light: it converts SVG primitives to
 * path `d` strings (reusing the cubic conventions in path-model.ts), runs the op,
 * and returns `d` string(s). The live compound-shape plumbing lives in state.ts.
 */

import { transformPathData } from './path-model';

export type BooleanOp = 'unite' | 'subtract' | 'intersect' | 'exclude' | 'divide';

/** Single-output ops produce one path; 'divide' produces many. */
export const SINGLE_OUTPUT_OPS: BooleanOp[] = ['unite', 'subtract', 'intersect', 'exclude'];

// ---- Engine lifecycle (lazy Paper.js) ----

// Paper has no bundled ESM types we want to lean on here; treat the scope loosely.
/* eslint-disable @typescript-eslint/no-explicit-any */
let paper: any = null;
let loading: Promise<void> | null = null;

/** Load Paper.js once and stand up a headless project. Safe to call repeatedly. */
export async function ensureBooleanEngine(): Promise<void> {
  if (paper) return;
  if (!loading) {
    // `paper` is aliased to paper-CORE in vite.config.ts (paper-full bundles a
    // PaperScript parser that calls `new Function()` — blocked by our CSP). The
    // core build is geometry-only (Path/CompoundPath/boolean ops) and CSP-safe.
    loading = import('paper').then((mod) => {
      const p = (mod as any).default ?? mod;
      // A detached canvas gives Paper a project without attaching to the page.
      p.setup(document.createElement('canvas'));
      // Never auto-insert created/result items into the project's active layer —
      // we only want geometry, and this keeps the headless project leak-free.
      p.settings.insertItems = false;
      paper = p;
    });
  }
  await loading;
}

/** True once Paper is loaded and synchronous compute is available. */
export function booleanEngineReady(): boolean {
  return !!paper;
}

// ---- Offset engine (Outline Stroke / Offset Path via paperjs-offset) ----

let paperOffset: any = null;
let offsetLoading: Promise<void> | null = null;

/** Load paper-core + the offset plugin once. */
export async function ensureOffsetEngine(): Promise<void> {
  await ensureBooleanEngine();
  if (paperOffset) return;
  if (!offsetLoading) {
    offsetLoading = import('paperjs-offset').then((mod) => {
      paperOffset = (mod as any).PaperOffset ?? (mod as any).default;
    });
  }
  await offsetLoading;
}

export function offsetEngineReady(): boolean {
  return !!paper && !!paperOffset;
}

export type StrokeJoin = 'miter' | 'round' | 'bevel';
export type StrokeCap = 'butt' | 'round';

/**
 * Offset a path's `d` inward (negative) or outward (positive) by `delta`,
 * preserving curves. Requires {@link ensureOffsetEngine}. Returns '' on failure.
 */
export function offsetPathData(d: string, delta: number, join: StrokeJoin = 'miter'): string {
  if (!paper || !paperOffset) throw new Error('Offset engine not loaded.');
  if (!d.trim() || delta === 0) return d;
  const src = new paper.CompoundPath({ pathData: d, insert: false });
  let out = '';
  try {
    const res = paperOffset.offset(src, delta, { join, insert: false });
    out = res?.pathData ?? '';
    res?.remove?.();
  } catch { out = ''; }
  src.remove();
  return out;
}

/**
 * Convert a stroke of the given width into a filled outline path's `d` (the
 * region the stroke covers). Requires {@link ensureOffsetEngine}. Returns '' on
 * failure or non-positive width.
 */
export function outlineStrokeData(d: string, width: number, join: StrokeJoin = 'miter', cap: StrokeCap = 'butt'): string {
  if (!paper || !paperOffset) throw new Error('Offset engine not loaded.');
  if (!d.trim() || width <= 0) return '';
  const src = new paper.CompoundPath({ pathData: d, insert: false });
  let out = '';
  try {
    const res = paperOffset.offsetStroke(src, width / 2, { join, cap, insert: false });
    out = res?.pathData ?? '';
    res?.remove?.();
  } catch { out = ''; }
  src.remove();
  return out;
}

// ---- Core computation ----

function toItem(d: string): any {
  // CompoundPath handles single- and multi-subpath geometry uniformly.
  return new paper.CompoundPath({ pathData: d, insert: false });
}

/**
 * Run a boolean op over operand `d` strings (given bottom→top in z-order, all in
 * the SAME coordinate space). Returns one `d` for single-output ops, or an array
 * of piece `d`s for 'divide'. Requires {@link ensureBooleanEngine} to have run.
 */
export function computeBoolean(operandDs: string[], op: BooleanOp): string[] {
  if (!paper) throw new Error('Boolean engine not loaded — call ensureBooleanEngine() first.');
  const ds = operandDs.filter((d) => d && d.trim());
  if (ds.length < 2) return ds.slice();

  const items = ds.map(toItem);
  try {
    if (op === 'divide') return divideAll(items);

    let acc = items[0];
    for (let i = 1; i < items.length; i++) {
      const next = items[i];
      acc =
        op === 'unite' ? acc.unite(next)
        : op === 'subtract' ? acc.subtract(next)
        : op === 'intersect' ? acc.intersect(next)
        : acc.exclude(next);
    }
    const d = pathDataOf(acc);
    return d ? [d] : [];
  } finally {
    for (const it of items) it.remove();
  }
}

/** Divide: split the union arrangement into all disjoint regions. */
function divideAll(items: any[]): string[] {
  // Start from the first operand; successively divide every accumulated piece by
  // the next operand, collecting the fragments. Handles the common 2-shape case
  // exactly and degrades gracefully for more.
  let pieces: any[] = [items[0]];
  for (let i = 1; i < items.length; i++) {
    const cutter = items[i];
    const nextPieces: any[] = [];
    for (const piece of pieces) {
      const result = piece.divide(cutter, { insert: false });
      nextPieces.push(...flattenResult(result));
    }
    // Also keep the parts of the cutter that fell outside everything so far.
    nextPieces.push(cutter);
    pieces = nextPieces;
  }
  return pieces.map(pathDataOf).filter((d): d is string => !!d);
}

/** Paper boolean results can be Path, CompoundPath, or Group — normalize to items. */
function flattenResult(result: any): any[] {
  if (!result) return [];
  if (result.className === 'Group') return result.children ? [...result.children] : [];
  return [result];
}

function pathDataOf(item: any): string {
  if (!item) return '';
  const d = (item.pathData ?? '').trim();
  return d;
}

// ---- SVG primitive → path `d` ----

function n(el: Element, attr: string, dflt = 0): number {
  const v = el.getAttribute(attr);
  if (v === null) return dflt;
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : dflt;
}

/** Round-rect path honoring SVG's rx/ry defaulting rules. */
function rectPath(x: number, y: number, w: number, h: number, rxAttr: number | null, ryAttr: number | null): string {
  let rx = rxAttr ?? ryAttr ?? 0;
  let ry = ryAttr ?? rxAttr ?? 0;
  rx = Math.min(Math.max(rx, 0), w / 2);
  ry = Math.min(Math.max(ry, 0), h / 2);
  if (rx === 0 || ry === 0) {
    return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
  }
  // Corners via elliptical arcs; transformPathData() converts them to cubics.
  return (
    `M ${x + rx} ${y}` +
    ` L ${x + w - rx} ${y} A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry}` +
    ` L ${x + w} ${y + h - ry} A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}` +
    ` L ${x + rx} ${y + h} A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry}` +
    ` L ${x} ${y + ry} A ${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`
  );
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  if (rx <= 0 || ry <= 0) return '';
  return (
    `M ${cx - rx} ${cy}` +
    ` A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy}` +
    ` A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`
  );
}

function pointsPath(points: string, close: boolean): string {
  const nums = (points.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
  if (nums.length < 4) return '';
  let d = `M ${nums[0]} ${nums[1]}`;
  for (let i = 2; i + 1 < nums.length; i += 2) d += ` L ${nums[i]} ${nums[i + 1]}`;
  return close ? d + ' Z' : d;
}

/** Geometry of any supported leaf element as a local-space path `d`. */
export function localPathData(el: SVGElement): string {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'path': return el.getAttribute('d') ?? '';
    case 'rect': {
      const rx = el.hasAttribute('rx') ? n(el, 'rx') : null;
      const ry = el.hasAttribute('ry') ? n(el, 'ry') : null;
      return rectPath(n(el, 'x'), n(el, 'y'), n(el, 'width'), n(el, 'height'), rx, ry);
    }
    case 'ellipse': return ellipsePath(n(el, 'cx'), n(el, 'cy'), n(el, 'rx'), n(el, 'ry'));
    case 'circle': return ellipsePath(n(el, 'cx'), n(el, 'cy'), n(el, 'r'), n(el, 'r'));
    case 'polygon': return pointsPath(el.getAttribute('points') ?? '', true);
    case 'polyline': return pointsPath(el.getAttribute('points') ?? '', false);
    case 'line': return `M ${n(el, 'x1')} ${n(el, 'y1')} L ${n(el, 'x2')} ${n(el, 'y2')}`;
    case 'g': return '';
    default: return '';
  }
}

/**
 * Geometry of an element expressed in a target coordinate space, given the matrix
 * that maps the element's local coords into that space. Béziers are affine, so
 * this is exact. Used to feed operands to {@link computeBoolean} in a common space.
 */
export function elementPathData(el: SVGElement, toTargetSpace: DOMMatrix): string {
  const local = localPathData(el);
  if (!local.trim()) return '';
  return transformPathData(local, toTargetSpace);
}

// ---- Export ----

/**
 * Flatten live booleans for export, in-place on a DOM subtree (operate on a CLONE
 * — this is destructive to the tree). For each `<g data-boolean>` it drops the
 * editable operand children and the internal markers, leaving a plain group that
 * paints only the cached result path. Keeps export markup clean and leak-free.
 */
export function stripBooleanOperands(root: Element): void {
  const wrappers = root.querySelectorAll('[data-boolean]');
  wrappers.forEach((w) => {
    w.querySelectorAll(':scope > [data-bool-operand]').forEach((op) => op.remove());
    w.removeAttribute('data-boolean');
    w.removeAttribute('data-bool-editing');
    w.querySelectorAll(':scope > [data-bool-result]').forEach((r) => r.removeAttribute('data-bool-result'));
  });
}
