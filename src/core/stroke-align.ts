/**
 * Stroke alignment (inside / outside / center).
 *
 * SVG has no native stroke-alignment — strokes always straddle the path centre,
 * and the SVG2 `stroke-alignment` property was never shipped by browsers. We
 * emulate it: render the stroke at DOUBLE width and clip away the half that
 * should not show. A `data-stroke-align` marker lets readStyle recover the
 * authored width (rendered width / 2).
 *
 *   inside       → clip to the shape itself (keep the inner half)
 *   outside+fill → paint the doubled stroke UNDER the fill (paint-order: stroke);
 *                  the fill covers the inner half, leaving only the outer half.
 *                  Keeps the fill, needs no clip.
 *   outside, no fill → clip to everything EXCEPT the shape (keep the outer half).
 *
 * The clip is a real <clipPath clipPathUnits="userSpaceOnUse"> in the canvas
 * <defs>. (A CSS `clip-path: path()` looks simpler but resolves its coordinates
 * relative to the element's *stroke* bounding box, which shifts with the doubled
 * width — so it can't be aligned reliably. userSpaceOnUse has no such ambiguity.)
 *
 * Only closed shapes have a meaningful inside/outside; open shapes (line, open
 * polyline/path) fall back to centre.
 */
import type { ShapeData } from './types';

export type StrokeAlign = 'center' | 'inside' | 'outside';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const STROKE_CLIP_PREFIX = 'sa-clip-';

function n(el: SVGElement, attr: string, dflt = 0): number {
  const v = el.getAttribute(attr);
  const f = v == null ? NaN : parseFloat(v);
  return Number.isFinite(f) ? f : dflt;
}

/** Local-space path data for a closed shape, or null if it has no enclosed area. */
export function shapeToClosedPathD(el: SVGElement, type: ShapeData['type']): string | null {
  switch (type) {
    case 'rect': {
      const x = n(el, 'x'), y = n(el, 'y'), w = n(el, 'width'), h = n(el, 'height');
      if (w <= 0 || h <= 0) return null;
      let rx = n(el, 'rx', NaN), ry = n(el, 'ry', NaN);
      if (!Number.isFinite(rx)) rx = Number.isFinite(ry) ? ry : 0;
      if (!Number.isFinite(ry)) ry = rx;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (rx <= 0 || ry <= 0) {
        return `M${x},${y} H${x + w} V${y + h} H${x} Z`;
      }
      return `M${x + rx},${y} H${x + w - rx} A${rx},${ry} 0 0 1 ${x + w},${y + ry} ` +
        `V${y + h - ry} A${rx},${ry} 0 0 1 ${x + w - rx},${y + h} H${x + rx} ` +
        `A${rx},${ry} 0 0 1 ${x},${y + h - ry} V${y + ry} A${rx},${ry} 0 0 1 ${x + rx},${y} Z`;
    }
    case 'ellipse': {
      const cx = n(el, 'cx'), cy = n(el, 'cy'), rx = n(el, 'rx'), ry = n(el, 'ry');
      if (rx <= 0 || ry <= 0) return null;
      return `M${cx - rx},${cy} a${rx},${ry} 0 1 0 ${rx * 2},0 a${rx},${ry} 0 1 0 ${-rx * 2},0 Z`;
    }
    case 'polygon': {
      const pts = (el.getAttribute('points') || '').trim();
      if (!pts) return null;
      return `M${pts} Z`;
    }
    case 'path': {
      const d = el.getAttribute('d') || '';
      // Only a fillable region if the subpath(s) are explicitly closed.
      return /z/i.test(d) ? d : null;
    }
    default:
      return null; // line, polyline (open), text, image, use, group
  }
}

function canvasDefs(el: SVGElement): SVGDefsElement | null {
  const svg = el.ownerSVGElement;
  if (!svg) return null;
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS(SVG_NS, 'defs');
    svg.insertBefore(defs, svg.firstChild);
  }
  return defs as SVGDefsElement;
}

function clipIdFor(el: SVGElement): string {
  return STROKE_CLIP_PREFIX + (el.id || 'anon');
}

function removeClip(el: SVGElement): void {
  el.removeAttribute('clip-path');
  el.ownerSVGElement?.querySelector('#' + clipIdFor(el))?.remove();
}

function dropEmptyStyle(el: SVGElement): void {
  if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
}

/**
 * Apply (or clear) stroke alignment on a live element. `authoredWidth` is the
 * width the user set; the rendered stroke-width becomes 2× that while aligned.
 * Idempotent — safe to call repeatedly (e.g. to re-sync the clip after the
 * element's geometry changes).
 */
export function applyStrokeAlignment(
  el: SVGElement,
  type: ShapeData['type'],
  align: StrokeAlign,
  authoredWidth: number,
): void {
  // Clear any prior paint-order emulation; re-set below only if needed.
  el.style.removeProperty('paint-order');

  const d = align === 'center' ? null : shapeToClosedPathD(el, type);

  if (!d) {
    el.setAttribute('stroke-width', String(authoredWidth));
    el.removeAttribute('data-stroke-align');
    removeClip(el);
    dropEmptyStyle(el);
    return;
  }

  el.setAttribute('stroke-width', String(authoredWidth * 2));
  el.setAttribute('data-stroke-align', align);

  // Outside + a fill: paint the doubled stroke beneath the fill so the fill hides
  // the inner half. Keeps the fill and needs no clip.
  if (align === 'outside' && (el.getAttribute('fill') ?? '').trim() !== 'none') {
    removeClip(el);
    el.style.paintOrder = 'stroke';
    return;
  }

  // Inside, or outside with no fill: clip the doubled stroke.
  dropEmptyStyle(el);
  const defs = canvasDefs(el);
  if (!defs) { el.removeAttribute('clip-path'); return; } // not in the DOM yet

  const id = clipIdFor(el);
  let clip = defs.querySelector('#' + id) as SVGClipPathElement | null;
  if (!clip) {
    clip = document.createElementNS(SVG_NS, 'clipPath') as SVGClipPathElement;
    clip.id = id;
    defs.appendChild(clip);
  }
  clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
  clip.textContent = '';

  const path = document.createElementNS(SVG_NS, 'path');
  if (align === 'inside') {
    path.setAttribute('d', d);
  } else {
    // Outside: clip to (bounds MINUS shape) via even-odd. Size the bounds from
    // the element's local bbox so the rect stays precise.
    let bx = 0, by = 0, bw = 0, bh = 0;
    try {
      const bb = (el as unknown as SVGGraphicsElement).getBBox();
      bx = bb.x; by = bb.y; bw = bb.width; bh = bb.height;
    } catch { /* not laid out yet */ }
    const m = authoredWidth * 2 + 4;
    const x0 = bx - m, y0 = by - m, x1 = bx + bw + m, y1 = by + bh + m;
    path.setAttribute('d', `M${x0},${y0} H${x1} V${y1} H${x0} Z ${d}`);
    path.setAttribute('clip-rule', 'evenodd');
  }
  clip.appendChild(path);
  el.setAttribute('clip-path', `url(#${id})`);
}
