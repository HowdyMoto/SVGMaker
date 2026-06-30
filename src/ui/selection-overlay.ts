import { tokens } from './tokens';
import type { AppState } from '../core/state';
import type { ShapeData } from '../core/types';
import { showGroupHint, hideGroupHint } from './group-hint';

const NS = 'http://www.w3.org/2000/svg';
const HANDLE_SIZE = 6;
const HANDLE_CURSORS: Record<string, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize',
  e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize',
  sw: 'nesw-resize', w: 'ew-resize',
};

function getHandlePositions(x: number, y: number, w: number, h: number) {
  return [
    { id: 'nw', cx: x, cy: y },
    { id: 'n', cx: x + w / 2, cy: y },
    { id: 'ne', cx: x + w, cy: y },
    { id: 'e', cx: x + w, cy: y + h / 2 },
    { id: 'se', cx: x + w, cy: y + h },
    { id: 's', cx: x + w / 2, cy: y + h },
    { id: 'sw', cx: x, cy: y + h },
    { id: 'w', cx: x, cy: y + h / 2 },
  ];
}

function appendResizeHandles(parent: SVGElement, x: number, y: number, w: number, h: number): void {
  for (const h2 of getHandlePositions(x, y, w, h)) {
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', String(h2.cx - HANDLE_SIZE / 2));
    rect.setAttribute('y', String(h2.cy - HANDLE_SIZE / 2));
    rect.setAttribute('width', String(HANDLE_SIZE));
    rect.setAttribute('height', String(HANDLE_SIZE));
    rect.setAttribute('fill', 'white');
    rect.setAttribute('stroke', tokens.selectionAccent);
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('data-handle', h2.id);
    rect.setAttribute('style', `cursor: ${HANDLE_CURSORS[h2.id]}`);
    parent.appendChild(rect);
  }
}

/**
 * Illustrator-style "live corner" widgets for rounded rectangles: a small
 * circular handle inset diagonally from each corner by the current radius.
 * Dragging one (handled in SelectTool via the `radius-*` data-handle) adjusts
 * the uniform corner radius. Hidden when the radius is 0 so it can't collide
 * with the square resize handles sitting on the corners.
 */
function appendRadiusHandles(parent: SVGElement, x: number, y: number, w: number, h: number, r: number): void {
  const maxR = Math.min(w, h) / 2;
  const rr = Math.max(0, Math.min(r, maxR));
  if (rr <= 0) return;
  const corners = [
    { id: 'radius-nw', cx: x + rr, cy: y + rr },
    { id: 'radius-ne', cx: x + w - rr, cy: y + rr },
    { id: 'radius-se', cx: x + w - rr, cy: y + h - rr },
    { id: 'radius-sw', cx: x + rr, cy: y + h - rr },
  ];
  for (const c of corners) {
    // Large invisible hit area so the handle is easy to grab without
    // accidentally clicking through to the shape underneath.
    const hit = document.createElementNS(NS, 'circle');
    hit.setAttribute('cx', String(c.cx));
    hit.setAttribute('cy', String(c.cy));
    hit.setAttribute('r', '9');
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('stroke', 'none');
    hit.setAttribute('pointer-events', 'all');
    hit.setAttribute('data-handle', c.id);
    hit.setAttribute('style', 'cursor: pointer');
    parent.appendChild(hit);

    // Visible dot (clicks pass through it to the hit area above).
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', String(c.cx));
    dot.setAttribute('cy', String(c.cy));
    dot.setAttribute('r', '4');
    dot.setAttribute('fill', 'white');
    dot.setAttribute('stroke', tokens.selectionAccent);
    dot.setAttribute('stroke-width', '1.5');
    dot.setAttribute('pointer-events', 'none');
    parent.appendChild(dot);
  }
}

export function updateSelectionOverlay(state: AppState, selectionLayer: SVGGElement): void {
  // Preserve marquee rect if it exists
  const marquee = selectionLayer.querySelector('#marquee-rect');
  selectionLayer.innerHTML = '';
  if (marquee) selectionLayer.appendChild(marquee);

  // Teach double-click-to-enter whenever a single (non-isolated) group is selected.
  updateGroupHint(state);

  // While node-editing a path, the node overlay owns the display.
  if (state.editingPathId) return;

  // Show which group is "entered" (double-click isolation), if any.
  drawActiveGroupOutline(state, selectionLayer);

  const selectedIds = state.selectedShapeIds;
  if (selectedIds.length === 0) return;

  // --- Multi-selection: draw individual bbox for each shape + combined bbox ---
  if (selectedIds.length > 1) {
    drawMultiSelection(state, selectionLayer, selectedIds);
    return;
  }

  // --- Single selection: full handles ---
  const shape = state.getSelectedShape();
  if (!shape) return;
  drawSingleSelection(shape, selectionLayer);
}

/** Context-aware group-editing hint (Select tool only): teach double-click-to-
 *  enter when a group is selected, and Esc-to-step-out once you're inside one. */
function updateGroupHint(state: AppState): void {
  if (state.currentTool !== 'select') { hideGroupHint(); return; }

  // Inside a group (isolation active): the useful action is stepping back out.
  if (state.activeGroupId) { showGroupHint('inside'); return; }

  // A single populated group is selected (not yet entered): teach how to enter.
  if (state.selectedShapeIds.length === 1) {
    const s = state.findShapeById(state.selectedShapeIds[0]);
    if (s && s.type === 'group' && (s.children?.length ?? 0) > 0) {
      showGroupHint('enter');
      return;
    }
  }
  hideGroupHint();
}

/** Faint dashed box around the group the user has entered (isolation mode). */
function drawActiveGroupOutline(state: AppState, selectionLayer: SVGGElement): void {
  const id = state.activeGroupId;
  if (!id) return;
  const shape = state.findShapeById(id);
  if (!shape) return;
  const el = shape.element as unknown as SVGGraphicsElement;
  let bbox: DOMRect;
  try { bbox = el.getBBox(); } catch { return; }
  if (bbox.width === 0 && bbox.height === 0) return;

  const g = document.createElementNS(NS, 'g');
  // Position via the element's screen transform so ancestor group transforms are included.
  const ref = selectionLayer.getScreenCTM();
  const own = el.getScreenCTM();
  if (ref && own) {
    const m = ref.inverse().multiply(own);
    g.setAttribute('transform', `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`);
  }
  appendRect(g, bbox.x, bbox.y, bbox.width, bbox.height, {
    fill: 'none', stroke: tokens.selectionAccent, strokeWidth: '1',
    strokeDasharray: '3,3', opacity: '0.5', pointerEvents: 'none',
  });
  selectionLayer.appendChild(g);
}

function drawSingleSelection(shape: ShapeData, selectionLayer: SVGGElement): void {
  const el = shape.element as unknown as SVGGraphicsElement;
  let bbox: DOMRect;
  try {
    bbox = el.getBBox();
  } catch {
    return;
  }
  if (bbox.width === 0 && bbox.height === 0) return;

  const x = bbox.x;
  const y = bbox.y;
  const w = bbox.width;
  const h = bbox.height;
  const overlayGroup = document.createElementNS(NS, 'g');
  if (shape.parentId) {
    // Nested shape: position via the full transform from the element's local
    // space to the selection layer, so ancestor group transforms are included.
    const ref = selectionLayer.getScreenCTM();
    const own = el.getScreenCTM();
    if (ref && own) {
      const m = ref.inverse().multiply(own);
      overlayGroup.setAttribute('transform', `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`);
    }
  } else {
    const transform = shape.element.getAttribute('transform');
    if (transform) overlayGroup.setAttribute('transform', transform);
  }

  // Blue bounding rect
  appendRect(overlayGroup, x, y, w, h, { fill: 'none', stroke: tokens.selectionAccent, strokeWidth: '1', pointerEvents: 'none' });

  // Live corner-radius handles for rounded rectangles. Drawn before the resize
  // handles so the corner squares stay on top and win clicks right at the corner.
  if (shape.type === 'rect' && el.tagName.toLowerCase() === 'rect') {
    const rx = parseFloat(el.getAttribute('rx') ?? '') || shape.style.rx || 0;
    appendRadiusHandles(overlayGroup, x, y, w, h, rx);
  }

  appendResizeHandles(overlayGroup, x, y, w, h);

  // Rotation handle
  const rotOffset = 20;
  const rotLine = document.createElementNS(NS, 'line');
  rotLine.setAttribute('x1', String(x + w / 2));
  rotLine.setAttribute('y1', String(y));
  rotLine.setAttribute('x2', String(x + w / 2));
  rotLine.setAttribute('y2', String(y - rotOffset));
  rotLine.setAttribute('stroke', tokens.selectionAccent);
  rotLine.setAttribute('stroke-width', '1');
  rotLine.setAttribute('pointer-events', 'none');
  overlayGroup.appendChild(rotLine);

  const rotCircle = document.createElementNS(NS, 'circle');
  rotCircle.setAttribute('cx', String(x + w / 2));
  rotCircle.setAttribute('cy', String(y - rotOffset));
  rotCircle.setAttribute('r', '5');
  rotCircle.setAttribute('fill', 'white');
  rotCircle.setAttribute('stroke', tokens.selectionAccent);
  rotCircle.setAttribute('stroke-width', '1.5');
  rotCircle.setAttribute('data-handle', 'rotate');
  rotCircle.setAttribute('style', 'cursor: crosshair');
  overlayGroup.appendChild(rotCircle);

  // Anchor dots for line-like shapes
  if (shape.type === 'line' || shape.type === 'polyline' || shape.type === 'path') {
    const corners = [
      { x: bbox.x, y: bbox.y },
      { x: bbox.x + bbox.width, y: bbox.y },
      { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
      { x: bbox.x, y: bbox.y + bbox.height },
    ];
    for (const c of corners) {
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', String(c.x));
      dot.setAttribute('cy', String(c.y));
      dot.setAttribute('r', '2.5');
      dot.setAttribute('fill', 'white');
      dot.setAttribute('stroke', tokens.selectionAccent);
      dot.setAttribute('stroke-width', '1');
      dot.setAttribute('pointer-events', 'none');
      overlayGroup.appendChild(dot);
    }
  }

  selectionLayer.appendChild(overlayGroup);
}

function drawMultiSelection(state: AppState, selectionLayer: SVGGElement, ids: string[]): void {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const id of ids) {
    const shape = state.findShapeById(id);
    if (!shape) continue;
    const el = shape.element as unknown as SVGGraphicsElement;
    let bbox: DOMRect;
    try {
      bbox = el.getBBox();
    } catch {
      continue;
    }
    if (bbox.width === 0 && bbox.height === 0) continue;

    // Individual highlight wrapped in the shape's transform
    const itemGroup = document.createElementNS(NS, 'g');
    const transform = shape.element.getAttribute('transform');
    if (transform) itemGroup.setAttribute('transform', transform);
    appendRect(itemGroup, bbox.x, bbox.y, bbox.width, bbox.height, {
      fill: 'none',
      stroke: tokens.selectionAccent,
      strokeWidth: '1',
      pointerEvents: 'none',
      opacity: '0.5',
    });
    selectionLayer.appendChild(itemGroup);

    // Track combined bounds in parent space by transforming bbox corners
    const corners = [
      { x: bbox.x, y: bbox.y },
      { x: bbox.x + bbox.width, y: bbox.y },
      { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
      { x: bbox.x, y: bbox.y + bbox.height },
    ];
    const svgEl = selectionLayer.closest('svg');
    if (svgEl) {
      const ctm = el.getCTM();
      const parentCtm = (selectionLayer.parentElement as unknown as SVGGraphicsElement)?.getCTM?.();
      if (ctm && parentCtm) {
        const inv = parentCtm.inverse();
        const m = inv.multiply(ctm);
        for (const c of corners) {
          const pt = svgEl.createSVGPoint();
          pt.x = c.x; pt.y = c.y;
          const transformed = pt.matrixTransform(m);
          minX = Math.min(minX, transformed.x);
          minY = Math.min(minY, transformed.y);
          maxX = Math.max(maxX, transformed.x);
          maxY = Math.max(maxY, transformed.y);
        }
      }
    }
  }

  if (!isFinite(minX)) return;

  const cw = maxX - minX;
  const ch = maxY - minY;

  // Combined bounding rect (solid)
  appendRect(selectionLayer, minX, minY, cw, ch, {
    fill: 'none',
    stroke: tokens.selectionAccent,
    strokeWidth: '1',
    pointerEvents: 'none',
    strokeDasharray: '4,2',
  });

  appendResizeHandles(selectionLayer, minX, minY, cw, ch);

  // Rotation handle
  const rotOffset = 20;
  const rotLine = document.createElementNS(NS, 'line');
  rotLine.setAttribute('x1', String(minX + cw / 2));
  rotLine.setAttribute('y1', String(minY));
  rotLine.setAttribute('x2', String(minX + cw / 2));
  rotLine.setAttribute('y2', String(minY - rotOffset));
  rotLine.setAttribute('stroke', tokens.selectionAccent);
  rotLine.setAttribute('stroke-width', '1');
  rotLine.setAttribute('pointer-events', 'none');
  selectionLayer.appendChild(rotLine);

  const rotCircle = document.createElementNS(NS, 'circle');
  rotCircle.setAttribute('cx', String(minX + cw / 2));
  rotCircle.setAttribute('cy', String(minY - rotOffset));
  rotCircle.setAttribute('r', '5');
  rotCircle.setAttribute('fill', 'white');
  rotCircle.setAttribute('stroke', tokens.selectionAccent);
  rotCircle.setAttribute('stroke-width', '1.5');
  rotCircle.setAttribute('data-handle', 'rotate');
  rotCircle.setAttribute('style', 'cursor: crosshair');
  selectionLayer.appendChild(rotCircle);

  // Selection count badge
  const badge = document.createElementNS(NS, 'text');
  badge.setAttribute('x', String(maxX + 8));
  badge.setAttribute('y', String(minY + 12));
  badge.setAttribute('fill', tokens.selectionAccent);
  badge.setAttribute('font-size', '11');
  badge.setAttribute('font-family', 'Arial, sans-serif');
  badge.setAttribute('pointer-events', 'none');
  badge.textContent = `${ids.length} objects`;
  selectionLayer.appendChild(badge);
}

function appendRect(
  parent: SVGElement,
  x: number, y: number, w: number, h: number,
  attrs: Record<string, string>,
): void {
  const rect = document.createElementNS(NS, 'rect');
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(w));
  rect.setAttribute('height', String(h));
  for (const [k, v] of Object.entries(attrs)) {
    // Convert camelCase to kebab-case for SVG attributes
    const attr = k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
    rect.setAttribute(attr, v);
  }
  parent.appendChild(rect);
}
