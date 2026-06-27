/**
 * Bake element transforms into geometry, producing transform-free drawing-layer
 * markup. Some consumers (e.g. TraceCraft) read only raw coordinates and ignore
 * transform attributes, so "Bake Transforms on Export" flattens every rotation/
 * scale/translate into the numbers themselves.
 *
 * Free-geometry shapes (path, polyline, polygon, line) bake exactly — Béziers
 * are affine-invariant. Position/size shapes (rect, ellipse, image, text, use)
 * fold a translate + axis-aligned scale into their attributes; a rotation/skew
 * (or non-uniform text scale) can't be expressed that way, so those keep a
 * single consolidated matrix and are surfaced in `warnings`.
 */

import { transformPathData } from './path-model';
import { stripBooleanOperands } from './boolean';

const EPS = 1e-6;

function isApproxIdentity(m: DOMMatrix): boolean {
  return Math.abs(m.a - 1) < EPS && Math.abs(m.b) < EPS && Math.abs(m.c) < EPS &&
    Math.abs(m.d - 1) < EPS && Math.abs(m.e) < EPS && Math.abs(m.f) < EPS;
}

function hasRotationOrSkew(m: DOMMatrix): boolean {
  return Math.abs(m.b) > EPS || Math.abs(m.c) > EPS;
}

function r(n: number): string {
  const v = Math.round(n * 1e4) / 1e4;
  return String(v === 0 ? 0 : v);
}

function apply(m: DOMMatrix, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

function num(el: SVGElement, attr: string, dflt = 0): number {
  const v = el.getAttribute(attr);
  return v === null ? dflt : parseFloat(v);
}

function bakePoints(points: string, m: DOMMatrix): string {
  const nums = (points.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
  const out: string[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const p = apply(m, nums[i], nums[i + 1]);
    out.push(`${r(p.x)},${r(p.y)}`);
  }
  return out.join(' ');
}

export function bakeLayerContent(live: SVGGElement): { content: string; warnings: string[] } {
  const layerCtm = live.getScreenCTM();
  if (!layerCtm) return { content: live.innerHTML, warnings: [] };
  const layerInv = layerCtm.inverse();
  const warnings = new Set<string>();
  const clone = live.cloneNode(true) as SVGGElement;
  bakeChildren(live, clone, layerInv, warnings);
  flattenStrokeAlign(clone, warnings);
  // Live booleans export as just their (now-baked) result path. Strip AFTER the
  // bake walk, which pairs live/clone children by index — removing operands early
  // would misalign that walk for the wrapper.
  stripBooleanOperands(clone);
  return { content: clone.innerHTML, warnings: [...warnings] };
}

/**
 * Inside/outside stroke alignment is emulated with a clip-path + doubled width
 * (see stroke-align.ts). A baked single path can't carry a clip, so revert to a
 * plain centered stroke at the authored width and warn.
 */
function flattenStrokeAlign(root: Element, warnings: Set<string>): void {
  const aligned = root.querySelectorAll('[data-stroke-align]');
  aligned.forEach(el => {
    const w = parseFloat(el.getAttribute('stroke-width') ?? '0');
    if (Number.isFinite(w)) el.setAttribute('stroke-width', String(w / 2));
    el.removeAttribute('data-stroke-align');
    el.removeAttribute('clip-path');
    (el as SVGElement).style?.removeProperty('paint-order');
    if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
  });
  if (aligned.length) {
    warnings.add('Inside/outside stroke alignment was flattened to centered — a baked single path cannot represent it.');
  }
}

function bakeChildren(live: Element, clone: Element, layerInv: DOMMatrix, warnings: Set<string>): void {
  const lk = live.children, ck = clone.children;
  for (let i = 0; i < lk.length && i < ck.length; i++) {
    bakeElement(lk[i] as SVGElement, ck[i] as SVGElement, layerInv, warnings);
  }
}

function bakeElement(live: SVGElement, clone: SVGElement, layerInv: DOMMatrix, warnings: Set<string>): void {
  const tag = live.tagName.toLowerCase();

  // Groups carry no geometry: strip their transform and bake the children with
  // the full ancestor-inclusive matrix (so position is preserved).
  if (tag === 'g') {
    clone.removeAttribute('transform');
    bakeChildren(live, clone, layerInv, warnings);
    return;
  }

  const screen = (live as unknown as SVGGraphicsElement).getScreenCTM?.();
  if (!screen) return; // not rendered (e.g. display:none) — leave untouched
  const m = layerInv.multiply(screen); // element-local -> artboard space
  if (isApproxIdentity(m)) { clone.removeAttribute('transform'); return; }

  // ---- Exact baking for free-geometry shapes ----
  if (tag === 'path') {
    clone.setAttribute('d', transformPathData(clone.getAttribute('d') ?? '', m));
    clone.removeAttribute('transform');
    return;
  }
  if (tag === 'polyline' || tag === 'polygon') {
    clone.setAttribute('points', bakePoints(clone.getAttribute('points') ?? '', m));
    clone.removeAttribute('transform');
    return;
  }
  if (tag === 'line') {
    const a = apply(m, num(clone, 'x1'), num(clone, 'y1'));
    const b = apply(m, num(clone, 'x2'), num(clone, 'y2'));
    clone.setAttribute('x1', r(a.x)); clone.setAttribute('y1', r(a.y));
    clone.setAttribute('x2', r(b.x)); clone.setAttribute('y2', r(b.y));
    clone.removeAttribute('transform');
    return;
  }

  // ---- Position/size shapes: only a translate + axis-aligned scale can fold
  // into attributes. A rotation/skew (or non-uniform text scale) stays a matrix.
  const nonUniformText = tag === 'text' && Math.abs(m.a - m.d) > EPS;
  if (hasRotationOrSkew(m) || nonUniformText) {
    clone.setAttribute('transform', `matrix(${r(m.a)} ${r(m.b)} ${r(m.c)} ${r(m.d)} ${r(m.e)} ${r(m.f)})`);
    warnings.add(`<${tag}> kept a transform — its rotation/scale can't bake into ${tag} geometry.`);
    return;
  }

  switch (tag) {
    case 'rect':
    case 'image':
      clone.setAttribute('x', r(m.a * num(clone, 'x') + m.e));
      clone.setAttribute('y', r(m.d * num(clone, 'y') + m.f));
      clone.setAttribute('width', r(num(clone, 'width') * m.a));
      clone.setAttribute('height', r(num(clone, 'height') * m.d));
      if (tag === 'rect') {
        if (clone.hasAttribute('rx')) clone.setAttribute('rx', r(num(clone, 'rx') * m.a));
        if (clone.hasAttribute('ry')) clone.setAttribute('ry', r(num(clone, 'ry') * m.d));
      }
      break;
    case 'ellipse':
      clone.setAttribute('cx', r(m.a * num(clone, 'cx') + m.e));
      clone.setAttribute('cy', r(m.d * num(clone, 'cy') + m.f));
      clone.setAttribute('rx', r(num(clone, 'rx') * m.a));
      clone.setAttribute('ry', r(num(clone, 'ry') * m.d));
      break;
    case 'text':
      clone.setAttribute('x', r(m.a * num(clone, 'x') + m.e));
      clone.setAttribute('y', r(m.d * num(clone, 'y') + m.f));
      if (clone.hasAttribute('font-size')) clone.setAttribute('font-size', r(num(clone, 'font-size') * m.a));
      break;
    case 'use':
      clone.setAttribute('x', r(m.a * num(clone, 'x') + m.e));
      clone.setAttribute('y', r(m.d * num(clone, 'y') + m.f));
      if (clone.hasAttribute('width')) clone.setAttribute('width', r(num(clone, 'width') * m.a));
      if (clone.hasAttribute('height')) clone.setAttribute('height', r(num(clone, 'height') * m.d));
      break;
    default:
      // Unknown element — keep a matrix so it stays visually correct.
      clone.setAttribute('transform', `matrix(${r(m.a)} ${r(m.b)} ${r(m.c)} ${r(m.d)} ${r(m.e)} ${r(m.f)})`);
      return;
  }
  clone.removeAttribute('transform');
}
