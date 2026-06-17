import type { AppState } from '../core/state';

const NS = 'http://www.w3.org/2000/svg';
const ACCENT = '#20a0ff';

/**
 * Render the node-editing overlay (anchors + handles for the path being edited)
 * into #guides-layer. Anchors carry `data-node-anchor="sp:i"` and handle knobs
 * carry `data-node-handle="sp:i:in|out"` for hit-testing by the tools.
 *
 * The overlay group replicates the path element's `transform` so anchor
 * coordinates (parsed in the element's local space) line up with what's drawn.
 */
export function renderNodeOverlay(state: AppState, guidesLayer: SVGGElement): void {
  // Clear any prior node overlay (leave other guides, e.g. pen preview, intact).
  guidesLayer.querySelectorAll('[data-node-overlay]').forEach(el => el.remove());

  const session = state.pathEdit;
  if (!state.editingPathId || !session) return;
  const shape = state.findShapeById(state.editingPathId);
  if (!shape) return;

  const group = document.createElementNS(NS, 'g');
  group.setAttribute('data-node-overlay', '1');
  const transform = shape.element.getAttribute('transform');
  if (transform) group.setAttribute('transform', transform);
  guidesLayer.appendChild(group);

  const A = 3.2;   // anchor half-size (user units)
  const H = 2.6;   // handle knob radius

  session.model.subpaths.forEach((sp, spi) => {
    sp.anchors.forEach((a, i) => {
      const selected = session.isSelected(spi, i);

      // Handles + connector lines (only for selected anchors, to reduce clutter).
      if (selected) {
        for (const which of ['in', 'out'] as const) {
          const hx = which === 'in' ? a.inX : a.outX;
          const hy = which === 'in' ? a.inY : a.outY;
          if (hx === undefined || hy === undefined) continue;
          const line = document.createElementNS(NS, 'line');
          line.setAttribute('x1', String(a.x)); line.setAttribute('y1', String(a.y));
          line.setAttribute('x2', String(hx)); line.setAttribute('y2', String(hy));
          line.setAttribute('stroke', ACCENT);
          line.setAttribute('stroke-width', '1');
          line.setAttribute('vector-effect', 'non-scaling-stroke');
          line.setAttribute('pointer-events', 'none');
          group.appendChild(line);

          const knob = document.createElementNS(NS, 'circle');
          knob.setAttribute('cx', String(hx)); knob.setAttribute('cy', String(hy));
          knob.setAttribute('r', String(H));
          knob.setAttribute('fill', ACCENT);
          knob.setAttribute('stroke', 'white');
          knob.setAttribute('stroke-width', '1');
          knob.setAttribute('vector-effect', 'non-scaling-stroke');
          knob.setAttribute('data-node-handle', `${spi}:${i}:${which}`);
          knob.setAttribute('style', 'cursor: crosshair');
          group.appendChild(knob);
        }
      }

      // Anchor marker: square for corner/broken, diamond for smooth.
      let marker: SVGElement;
      if (a.type === 'smooth') {
        marker = document.createElementNS(NS, 'path');
        marker.setAttribute('d', `M ${a.x} ${a.y - A * 1.3} L ${a.x + A * 1.3} ${a.y} L ${a.x} ${a.y + A * 1.3} L ${a.x - A * 1.3} ${a.y} Z`);
      } else {
        marker = document.createElementNS(NS, 'rect');
        marker.setAttribute('x', String(a.x - A));
        marker.setAttribute('y', String(a.y - A));
        marker.setAttribute('width', String(A * 2));
        marker.setAttribute('height', String(A * 2));
      }
      marker.setAttribute('fill', selected ? ACCENT : 'white');
      marker.setAttribute('stroke', ACCENT);
      marker.setAttribute('stroke-width', '1.25');
      marker.setAttribute('vector-effect', 'non-scaling-stroke');
      marker.setAttribute('data-node-anchor', `${spi}:${i}`);
      marker.setAttribute('style', 'cursor: pointer');
      group.appendChild(marker);
    });
  });
}
