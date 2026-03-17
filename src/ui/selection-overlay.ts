import type { AppState } from '../core/state';

const NS = 'http://www.w3.org/2000/svg';

export function updateSelectionOverlay(state: AppState, selectionLayer: SVGGElement): void {
  selectionLayer.innerHTML = '';
  const shape = state.getSelectedShape();
  if (!shape) return;

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

  // Blue selection rectangle (Illustrator style)
  const rect = document.createElementNS(NS, 'rect');
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(w));
  rect.setAttribute('height', String(h));
  rect.setAttribute('fill', 'none');
  rect.setAttribute('stroke', '#20a0ff');
  rect.setAttribute('stroke-width', '1');
  rect.setAttribute('pointer-events', 'none');
  selectionLayer.appendChild(rect);

  // Resize handles (white squares with blue border)
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
    const handle = document.createElementNS(NS, 'rect');
    handle.setAttribute('x', String(h.cx - handleSize / 2));
    handle.setAttribute('y', String(h.cy - handleSize / 2));
    handle.setAttribute('width', String(handleSize));
    handle.setAttribute('height', String(handleSize));
    handle.setAttribute('fill', 'white');
    handle.setAttribute('stroke', '#20a0ff');
    handle.setAttribute('stroke-width', '1');
    handle.setAttribute('data-handle', h.id);
    handle.setAttribute('style', `cursor: ${cursors[h.id]}`);
    selectionLayer.appendChild(handle);
  }

  // Corner anchor points for lines
  if (shape.type === 'line' || shape.type === 'polyline' || shape.type === 'path') {
    // Show anchor dots on corners
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
      selectionLayer.appendChild(dot);
    }
  }
}
