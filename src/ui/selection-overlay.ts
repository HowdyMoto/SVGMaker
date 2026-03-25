import type { AppState } from '../core/state';
import type { ShapeData } from '../core/types';

const NS = 'http://www.w3.org/2000/svg';

export function updateSelectionOverlay(state: AppState, selectionLayer: SVGGElement): void {
  // Preserve marquee rect if it exists
  const marquee = selectionLayer.querySelector('#marquee-rect');
  selectionLayer.innerHTML = '';
  if (marquee) selectionLayer.appendChild(marquee);

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
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rotation = shape.rotation ?? 0;

  const overlayGroup = document.createElementNS(NS, 'g');
  if (rotation !== 0) {
    overlayGroup.setAttribute('transform', `rotate(${rotation}, ${cx}, ${cy})`);
  }

  // Blue bounding rect
  appendRect(overlayGroup, x, y, w, h, { fill: 'none', stroke: '#20a0ff', strokeWidth: '1', pointerEvents: 'none' });

  // Resize handles
  const handleSize = 6;
  const handles = [
    { id: 'nw', cx: x, cy: y },
    { id: 'n', cx: x + w / 2, cy: y },
    { id: 'ne', cx: x + w, cy: y },
    { id: 'e', cx: x + w, cy: y + h / 2 },
    { id: 'se', cx: x + w, cy: y + h },
    { id: 's', cx: x + w / 2, cy: y + h },
    { id: 'sw', cx: x, cy: y + h },
    { id: 'w', cx: x, cy: y + h / 2 },
  ];
  const cursors: Record<string, string> = {
    nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize',
    e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize',
    sw: 'nesw-resize', w: 'ew-resize',
  };
  for (const h of handles) {
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', String(h.cx - handleSize / 2));
    rect.setAttribute('y', String(h.cy - handleSize / 2));
    rect.setAttribute('width', String(handleSize));
    rect.setAttribute('height', String(handleSize));
    rect.setAttribute('fill', 'white');
    rect.setAttribute('stroke', '#20a0ff');
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('data-handle', h.id);
    rect.setAttribute('style', `cursor: ${cursors[h.id]}`);
    overlayGroup.appendChild(rect);
  }

  // Rotation handle
  const rotOffset = 20;
  const rotLine = document.createElementNS(NS, 'line');
  rotLine.setAttribute('x1', String(x + w / 2));
  rotLine.setAttribute('y1', String(y));
  rotLine.setAttribute('x2', String(x + w / 2));
  rotLine.setAttribute('y2', String(y - rotOffset));
  rotLine.setAttribute('stroke', '#20a0ff');
  rotLine.setAttribute('stroke-width', '1');
  rotLine.setAttribute('pointer-events', 'none');
  overlayGroup.appendChild(rotLine);

  const rotCircle = document.createElementNS(NS, 'circle');
  rotCircle.setAttribute('cx', String(x + w / 2));
  rotCircle.setAttribute('cy', String(y - rotOffset));
  rotCircle.setAttribute('r', '5');
  rotCircle.setAttribute('fill', 'white');
  rotCircle.setAttribute('stroke', '#20a0ff');
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
      dot.setAttribute('stroke', '#20a0ff');
      dot.setAttribute('stroke-width', '1');
      dot.setAttribute('pointer-events', 'none');
      overlayGroup.appendChild(dot);
    }
  }

  selectionLayer.appendChild(overlayGroup);
}

function drawMultiSelection(state: AppState, selectionLayer: SVGGElement, ids: string[]): void {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  // Draw individual bbox outlines for each selected shape
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

    // Track combined bounds
    minX = Math.min(minX, bbox.x);
    minY = Math.min(minY, bbox.y);
    maxX = Math.max(maxX, bbox.x + bbox.width);
    maxY = Math.max(maxY, bbox.y + bbox.height);

    // Individual shape highlight (thinner, semi-transparent)
    appendRect(selectionLayer, bbox.x, bbox.y, bbox.width, bbox.height, {
      fill: 'none',
      stroke: '#20a0ff',
      strokeWidth: '1',
      pointerEvents: 'none',
      opacity: '0.5',
    });
  }

  if (!isFinite(minX)) return;

  const cw = maxX - minX;
  const ch = maxY - minY;

  // Combined bounding rect (solid)
  appendRect(selectionLayer, minX, minY, cw, ch, {
    fill: 'none',
    stroke: '#20a0ff',
    strokeWidth: '1',
    pointerEvents: 'none',
    strokeDasharray: '4,2',
  });

  // Resize handles on the combined bbox
  const handleSize = 6;
  const handles = [
    { id: 'nw', cx: minX, cy: minY },
    { id: 'n', cx: minX + cw / 2, cy: minY },
    { id: 'ne', cx: maxX, cy: minY },
    { id: 'e', cx: maxX, cy: minY + ch / 2 },
    { id: 'se', cx: maxX, cy: maxY },
    { id: 's', cx: minX + cw / 2, cy: maxY },
    { id: 'sw', cx: minX, cy: maxY },
    { id: 'w', cx: minX, cy: minY + ch / 2 },
  ];
  const cursors: Record<string, string> = {
    nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize',
    e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize',
    sw: 'nesw-resize', w: 'ew-resize',
  };
  for (const h of handles) {
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', String(h.cx - handleSize / 2));
    rect.setAttribute('y', String(h.cy - handleSize / 2));
    rect.setAttribute('width', String(handleSize));
    rect.setAttribute('height', String(handleSize));
    rect.setAttribute('fill', 'white');
    rect.setAttribute('stroke', '#20a0ff');
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('data-handle', h.id);
    rect.setAttribute('style', `cursor: ${cursors[h.id]}`);
    selectionLayer.appendChild(rect);
  }

  // Selection count badge
  const badge = document.createElementNS(NS, 'text');
  badge.setAttribute('x', String(maxX + 8));
  badge.setAttribute('y', String(minY + 12));
  badge.setAttribute('fill', '#20a0ff');
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
    if (k === 'pointerEvents') rect.setAttribute('pointer-events', v);
    else if (k === 'strokeWidth') rect.setAttribute('stroke-width', v);
    else if (k === 'strokeDasharray') rect.setAttribute('stroke-dasharray', v);
    else rect.setAttribute(k, v);
  }
  parent.appendChild(rect);
}
