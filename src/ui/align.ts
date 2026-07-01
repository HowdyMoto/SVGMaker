import type { AppState } from '../core/state';
import { nudgeTranslate } from '../core/transform';

export function setupAlign(state: AppState): void {
  document.querySelectorAll('.align-buttons button[data-align]').forEach(btn => {
    btn.addEventListener('click', () => {
      const align = btn.getAttribute('data-align')!;
      const shape = state.getSelectedShape();
      if (!shape) return;

      const el = shape.element as unknown as SVGGraphicsElement;
      let bbox: DOMRect;
      try { bbox = el.getBBox(); } catch { return; }

      const artboard = state.artboard;
      const tag = shape.element.tagName.toLowerCase();

      switch (align) {
        case 'left': setPos(shape.element, tag, 0, bbox.y, bbox); break;
        case 'center-h': setPos(shape.element, tag, (artboard.width - bbox.width) / 2, bbox.y, bbox); break;
        case 'right': setPos(shape.element, tag, artboard.width - bbox.width, bbox.y, bbox); break;
        case 'top': setPos(shape.element, tag, bbox.x, 0, bbox); break;
        case 'center-v': setPos(shape.element, tag, bbox.x, (artboard.height - bbox.height) / 2, bbox); break;
        case 'bottom': setPos(shape.element, tag, bbox.x, artboard.height - bbox.height, bbox); break;
      }

      state.saveHistory();
      state.onChange_public();
    });
  });

  // Distribute: evenly space the centers of 3+ selected objects between the two
  // outermost, which stay put (matches Illustrator's Distribute Objects).
  document.querySelectorAll('.align-buttons button[data-distribute]').forEach(btn => {
    btn.addEventListener('click', () => {
      const axis = btn.getAttribute('data-distribute')!; // 'h' | 'v'
      const items = state.selectedShapeIds
        .map(id => state.findShapeById(id))
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map(s => {
          const el = s.element as SVGElement;
          let bbox: DOMRect;
          try { bbox = (el as unknown as SVGGraphicsElement).getBBox(); } catch { return null; }
          const center = axis === 'h' ? bbox.x + bbox.width / 2 : bbox.y + bbox.height / 2;
          return { el, tag: el.tagName.toLowerCase(), bbox, center };
        })
        .filter((x): x is NonNullable<typeof x> => !!x);
      if (items.length < 3) return;

      items.sort((a, b) => a.center - b.center);
      const first = items[0].center;
      const step = (items[items.length - 1].center - first) / (items.length - 1);
      for (let i = 1; i < items.length - 1; i++) {
        const it = items[i];
        const target = first + i * step;
        if (axis === 'h') setPos(it.el, it.tag, target - it.bbox.width / 2, it.bbox.y, it.bbox);
        else setPos(it.el, it.tag, it.bbox.x, target - it.bbox.height / 2, it.bbox);
      }
      state.saveHistory();
      state.onChange_public();
    });
  });
}

function setPos(el: SVGElement, tag: string, x: number, y: number, bbox: DOMRect): void {
  const dx = x - bbox.x;
  const dy = y - bbox.y;

  if (tag === 'rect' || tag === 'text') {
    el.setAttribute('x', String(parseFloat(el.getAttribute('x') ?? '0') + dx));
    el.setAttribute('y', String(parseFloat(el.getAttribute('y') ?? '0') + dy));
  } else if (tag === 'ellipse') {
    el.setAttribute('cx', String(parseFloat(el.getAttribute('cx') ?? '0') + dx));
    el.setAttribute('cy', String(parseFloat(el.getAttribute('cy') ?? '0') + dy));
  } else if (tag === 'line') {
    el.setAttribute('x1', String(parseFloat(el.getAttribute('x1') ?? '0') + dx));
    el.setAttribute('y1', String(parseFloat(el.getAttribute('y1') ?? '0') + dy));
    el.setAttribute('x2', String(parseFloat(el.getAttribute('x2') ?? '0') + dx));
    el.setAttribute('y2', String(parseFloat(el.getAttribute('y2') ?? '0') + dy));
  } else if (tag === 'polyline' || tag === 'polygon') {
    const points = el.getAttribute('points') ?? '';
    const pairs = points.trim().split(/\s+/).map(p => p.split(',').map(Number));
    const newPoints = pairs.map(([px, py]) => `${px + dx},${py + dy}`).join(' ');
    el.setAttribute('points', newPoints);
  } else if (tag === 'path') {
    nudgeTranslate(el, dx, dy);
  }
}
