// ---------------------------------------------------------------------------
// Coordinate-space helpers — the element-local ↔ drawing-layer (user) space
// conversions that tools and geometry code previously re-inlined at ~a dozen
// sites (three byte-identical `toLocal`s, two identical bbox-corner loops).
//
// All of these map relative to `#drawing-layer`, which is the space that
// Canvas.screenToSVG() (the single screen→world entry point) produces — so a
// point that came from a pointer event can be pushed straight into an element's
// local space and back. CTMs are read via getCTM (relative to the nearest
// viewport, i.e. the SVG), and the viewBox offset cancels because both the
// element and the drawing layer share it.
// ---------------------------------------------------------------------------

import type { Point, BBox } from './types';

function drawingLayerOf(svgCanvas: SVGSVGElement): SVGGraphicsElement | null {
  return svgCanvas.querySelector('#drawing-layer') as unknown as SVGGraphicsElement | null;
}

/**
 * Map a point from drawing-layer (user) space into `el`'s local space. Returns the
 * input unchanged when the CTMs aren't available (e.g. a detached element), which
 * matches the previous per-tool behavior.
 */
export function worldToLocal(svgCanvas: SVGSVGElement, el: SVGElement | null, pt: Point): Point {
  const elCtm = (el as unknown as SVGGraphicsElement | null)?.getCTM?.();
  const parentCtm = drawingLayerOf(svgCanvas)?.getCTM?.();
  if (!elCtm || !parentCtm) return pt;
  const m = parentCtm.inverse().multiply(elCtm); // element-local → drawing-layer space
  const p = svgCanvas.createSVGPoint();
  p.x = pt.x; p.y = pt.y;
  const local = p.matrixTransform(m.inverse());
  return { x: local.x, y: local.y };
}

/**
 * An element's axis-aligned bbox expressed in drawing-layer (user) space: its local
 * getBBox with each corner mapped through the element's transform chain. Falls back
 * to the raw local bbox when CTMs are unavailable; null when getBBox throws (an
 * element with no renderable geometry).
 */
export function localBBoxInLayer(svgCanvas: SVGSVGElement, el: SVGGraphicsElement): BBox | null {
  const parentCtm = drawingLayerOf(svgCanvas)?.getCTM?.();
  try {
    const bbox = el.getBBox();
    const ctm = el.getCTM();
    if (!ctm || !parentCtm) return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
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
  } catch {
    return null;
  }
}
