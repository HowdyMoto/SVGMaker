import { BaseTool } from './base';
import type { Point, ShapeData } from '../core/types';

const NS = 'http://www.w3.org/2000/svg';

export class SelectTool extends BaseTool {
  name = 'select';

  // Drag-move state
  private dragging = false;
  private dragStart: Point = { x: 0, y: 0 };
  private dragOrigPositions: Map<string, { x: number; y: number }> = new Map();

  // Resize state
  private resizing = false;
  private resizeHandle = '';
  private resizeOrigBBox: DOMRect | null = null;
  private resizeStart: Point = { x: 0, y: 0 };

  // Rotation state
  private rotating = false;
  private rotateCenter: Point = { x: 0, y: 0 };
  private rotateStartAngle = 0;
  private rotateOrigAngle = 0;

  // Marquee (rubber-band) selection state
  private marquee = false;
  private marqueeStart: Point = { x: 0, y: 0 };
  private marqueeRect: SVGRectElement | null = null;

  onMouseDown(pt: Point, e: MouseEvent): void {
    // --- Handle click on resize/rotate handle ---
    const handle = (e.target as SVGElement).getAttribute?.('data-handle');
    if (handle && this.state.selectedShapeId) {
      const shape = this.state.getSelectedShape();
      if (!shape) return;

      if (handle === 'rotate') {
        this.rotating = true;
        const bbox = (shape.element as unknown as SVGGraphicsElement).getBBox();
        this.rotateCenter = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
        this.rotateStartAngle = Math.atan2(pt.y - this.rotateCenter.y, pt.x - this.rotateCenter.x) * 180 / Math.PI;
        this.rotateOrigAngle = shape.rotation ?? 0;
        return;
      }

      this.resizing = true;
      this.resizeHandle = handle;
      this.resizeStart = { ...pt };
      // For multi-select, use combined bbox
      if (this.state.selectedShapeIds.length > 1) {
        this.resizeOrigBBox = this.getCombinedBBox(this.getSelectedShapes());
      } else {
        this.resizeOrigBBox = (shape.element as unknown as SVGGraphicsElement).getBBox();
      }
      return;
    }

    // --- Check if clicking on a shape ---
    const target = e.target as SVGElement;
    const shapeEl = this.findShapeElement(target);

    if (shapeEl) {
      // Adobe-style: Shift+click toggles add/remove from selection
      if (e.shiftKey) {
        this.state.toggleMultiSelect(shapeEl.id);
      } else {
        // If clicking on an already-selected shape in a multi-selection, keep multi
        if (this.state.selectedShapeIds.includes(shapeEl.id) && this.state.selectedShapeIds.length > 1) {
          // Don't change selection, just start dragging the group
        } else {
          this.state.selectShape(shapeEl.id);
        }
      }

      // Start drag for all selected shapes
      this.dragging = true;
      this.dragStart = { ...pt };
      this.dragOrigPositions.clear();
      for (const id of this.state.selectedShapeIds) {
        const s = this.state.findShapeById(id);
        if (s) {
          this.dragOrigPositions.set(id, this.getElementPos(s.element));
        }
      }
    } else {
      // Clicked on empty space
      const isCanvas = target.id === 'canvas-bg' || target.id === 'canvas-grid' ||
        target.closest('#canvas-bg') !== null || target.closest('#canvas-grid') !== null ||
        target.closest('#artboards-layer') !== null || target.id === 'pasteboard';

      if (isCanvas) {
        if (e.button === 1) {
          this.canvas.startPan(e.clientX, e.clientY);
        } else {
          // Start marquee selection (unless shift is held, which preserves existing selection)
          if (!e.shiftKey) {
            this.state.selectShape(null);
          }
          this.marquee = true;
          this.marqueeStart = { ...pt };
          this.createMarqueeRect(pt);
        }
      }
    }
  }

  onMouseMove(pt: Point, e: MouseEvent): void {
    // --- Marquee drag ---
    if (this.marquee) {
      this.updateMarqueeRect(pt);
      return;
    }

    // --- Rotation ---
    if (this.rotating) {
      const shape = this.state.getSelectedShape();
      if (!shape) return;
      const currentAngle = Math.atan2(pt.y - this.rotateCenter.y, pt.x - this.rotateCenter.x) * 180 / Math.PI;
      let newRotation = this.rotateOrigAngle + (currentAngle - this.rotateStartAngle);
      // Shift snaps to 15-degree increments
      if (e.shiftKey) {
        newRotation = Math.round(newRotation / 15) * 15;
      }
      newRotation = Math.round(newRotation * 10) / 10;
      shape.rotation = newRotation;
      this.applyRotation(shape);
      this.state.onChange_public();
      return;
    }

    // --- Resize ---
    if (this.resizing && this.resizeOrigBBox) {
      if (this.state.selectedShapeIds.length <= 1) {
        const shape = this.state.getSelectedShape();
        if (!shape) return;
        const dx = pt.x - this.resizeStart.x;
        const dy = pt.y - this.resizeStart.y;
        this.applyResize(shape.element, shape.type, this.resizeOrigBBox, dx, dy, this.resizeHandle);
      }
      this.state.onChange_public();
      return;
    }

    // --- Multi-drag ---
    if (this.dragging && this.dragOrigPositions.size > 0) {
      const dx = pt.x - this.dragStart.x;
      const dy = pt.y - this.dragStart.y;
      for (const id of this.state.selectedShapeIds) {
        const s = this.state.findShapeById(id);
        const orig = this.dragOrigPositions.get(id);
        if (s && orig) {
          this.moveElement(s.element, s.type, orig.x + dx, orig.y + dy);
        }
      }
      this.state.onChange_public();
    }
  }

  onMouseUp(pt: Point, e: MouseEvent): void {
    // --- Finish marquee ---
    if (this.marquee) {
      this.finishMarquee(pt, e.shiftKey);
      this.marquee = false;
      this.removeMarqueeRect();
      return;
    }

    if (this.dragging || this.resizing || this.rotating) {
      this.state.saveHistory();
      this.dragging = false;
      this.resizing = false;
      this.rotating = false;
      this.resizeOrigBBox = null;
      this.dragOrigPositions.clear();
    }
    this.canvas.endPan();
  }

  // ---- Marquee helpers ----

  private createMarqueeRect(pt: Point): void {
    const selLayer = this.svgCanvas.querySelector('#selection-layer') as SVGGElement;
    if (!selLayer) return;
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', String(pt.x));
    rect.setAttribute('y', String(pt.y));
    rect.setAttribute('width', '0');
    rect.setAttribute('height', '0');
    rect.setAttribute('fill', 'rgba(32, 160, 255, 0.08)');
    rect.setAttribute('stroke', '#20a0ff');
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('stroke-dasharray', '4,3');
    rect.setAttribute('pointer-events', 'none');
    rect.id = 'marquee-rect';
    selLayer.appendChild(rect);
    this.marqueeRect = rect;
  }

  private updateMarqueeRect(pt: Point): void {
    if (!this.marqueeRect) return;
    const x = Math.min(pt.x, this.marqueeStart.x);
    const y = Math.min(pt.y, this.marqueeStart.y);
    const w = Math.abs(pt.x - this.marqueeStart.x);
    const h = Math.abs(pt.y - this.marqueeStart.y);
    this.marqueeRect.setAttribute('x', String(x));
    this.marqueeRect.setAttribute('y', String(y));
    this.marqueeRect.setAttribute('width', String(w));
    this.marqueeRect.setAttribute('height', String(h));
  }

  private removeMarqueeRect(): void {
    this.marqueeRect?.remove();
    this.marqueeRect = null;
  }

  private finishMarquee(pt: Point, additive: boolean): void {
    const mx = Math.min(pt.x, this.marqueeStart.x);
    const my = Math.min(pt.y, this.marqueeStart.y);
    const mw = Math.abs(pt.x - this.marqueeStart.x);
    const mh = Math.abs(pt.y - this.marqueeStart.y);

    // Minimum drag distance to count as marquee (not accidental click)
    if (mw < 3 && mh < 3) return;

    const hitIds: string[] = [];
    for (const shape of this.state.shapes) {
      if (!shape.visible || shape.locked) continue;
      try {
        const bbox = (shape.element as unknown as SVGGraphicsElement).getBBox();
        // Shape is selected if its bbox intersects the marquee
        if (this.rectsIntersect(mx, my, mw, mh, bbox.x, bbox.y, bbox.width, bbox.height)) {
          hitIds.push(shape.id);
        }
      } catch { /* skip */ }
    }

    if (hitIds.length === 0) return;

    if (additive) {
      // Shift+marquee: add to existing selection
      const combined = new Set([...this.state.selectedShapeIds, ...hitIds]);
      this.state.selectMultiple([...combined]);
    } else {
      this.state.selectMultiple(hitIds);
    }
  }

  private rectsIntersect(
    ax: number, ay: number, aw: number, ah: number,
    bx: number, by: number, bw: number, bh: number,
  ): boolean {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  // ---- Shape finding ----

  private findShapeElement(target: SVGElement): SVGElement | null {
    let el: SVGElement | null = target;
    let topShape: SVGElement | null = null;
    while (el) {
      if (el.id && el.id.startsWith('shape-')) topShape = el;
      if (el.id === 'drawing-layer') break;
      el = el.parentElement as SVGElement | null;
    }
    return topShape;
  }

  private getSelectedShapes(): ShapeData[] {
    return this.state.selectedShapeIds
      .map(id => this.state.findShapeById(id))
      .filter((s): s is ShapeData => s !== null);
  }

  private getCombinedBBox(shapes: ShapeData[]): DOMRect {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of shapes) {
      try {
        const bbox = (s.element as unknown as SVGGraphicsElement).getBBox();
        minX = Math.min(minX, bbox.x);
        minY = Math.min(minY, bbox.y);
        maxX = Math.max(maxX, bbox.x + bbox.width);
        maxY = Math.max(maxY, bbox.y + bbox.height);
      } catch { /* skip */ }
    }
    return new DOMRect(minX, minY, maxX - minX, maxY - minY);
  }

  // ---- Position helpers ----

  private getElementPos(el: SVGElement): { x: number; y: number } {
    const tag = el.tagName.toLowerCase();
    if (tag === 'g') {
      const bbox = (el as unknown as SVGGraphicsElement).getBBox();
      return { x: bbox.x, y: bbox.y };
    }
    if (tag === 'rect' || tag === 'text' || tag === 'image' || tag === 'use') {
      return {
        x: parseFloat(el.getAttribute('x') ?? '0'),
        y: parseFloat(el.getAttribute('y') ?? '0'),
      };
    }
    if (tag === 'ellipse') {
      return {
        x: parseFloat(el.getAttribute('cx') ?? '0'),
        y: parseFloat(el.getAttribute('cy') ?? '0'),
      };
    }
    if (tag === 'line') {
      return {
        x: parseFloat(el.getAttribute('x1') ?? '0'),
        y: parseFloat(el.getAttribute('y1') ?? '0'),
      };
    }
    if (tag === 'polyline' || tag === 'polygon') {
      const points = el.getAttribute('points') ?? '';
      const first = points.trim().split(/[\s,]+/);
      return { x: parseFloat(first[0] ?? '0'), y: parseFloat(first[1] ?? '0') };
    }
    if (tag === 'path') {
      const bbox = (el as unknown as SVGGraphicsElement).getBBox();
      return { x: bbox.x, y: bbox.y };
    }
    return { x: 0, y: 0 };
  }

  private moveElement(el: SVGElement, type: string, x: number, y: number): void {
    const tag = el.tagName.toLowerCase();
    if (tag === 'g') {
      const bbox = (el as unknown as SVGGraphicsElement).getBBox();
      const dx = x - bbox.x;
      const dy = y - bbox.y;
      const existing = el.getAttribute('transform') ?? '';
      const match = existing.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
      if (match) {
        const newTx = parseFloat(match[1]) + dx;
        const newTy = parseFloat(match[2]) + dy;
        el.setAttribute('transform', existing.replace(/translate\(([-\d.]+),\s*([-\d.]+)\)/, `translate(${newTx}, ${newTy})`));
      } else {
        el.setAttribute('transform', (existing ? existing + ' ' : '') + `translate(${dx}, ${dy})`);
      }
      return;
    }
    if (tag === 'rect' || tag === 'image' || tag === 'use' || (tag === 'text' && type === 'text')) {
      el.setAttribute('x', String(x));
      el.setAttribute('y', String(y));
    } else if (tag === 'ellipse') {
      el.setAttribute('cx', String(x));
      el.setAttribute('cy', String(y));
    } else if (tag === 'line') {
      const x1 = parseFloat(el.getAttribute('x1') ?? '0');
      const y1 = parseFloat(el.getAttribute('y1') ?? '0');
      const x2 = parseFloat(el.getAttribute('x2') ?? '0');
      const y2 = parseFloat(el.getAttribute('y2') ?? '0');
      const dx = x - x1;
      const dy = y - y1;
      el.setAttribute('x1', String(x1 + dx));
      el.setAttribute('y1', String(y1 + dy));
      el.setAttribute('x2', String(x2 + dx));
      el.setAttribute('y2', String(y2 + dy));
    } else if (tag === 'polyline' || tag === 'polygon') {
      const points = el.getAttribute('points') ?? '';
      const pairs = points.trim().split(/\s+/).map(p => p.split(',').map(Number));
      if (pairs.length === 0) return;
      const dx = x - pairs[0][0];
      const dy = y - pairs[0][1];
      const newPoints = pairs.map(([px, py]) => `${px + dx},${py + dy}`).join(' ');
      el.setAttribute('points', newPoints);
    } else if (tag === 'path') {
      const bbox = (el as unknown as SVGGraphicsElement).getBBox();
      const dx = x - bbox.x;
      const dy = y - bbox.y;
      const existing = el.getAttribute('transform') ?? '';
      const match = existing.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
      if (match) {
        const newTx = parseFloat(match[1]) + dx;
        const newTy = parseFloat(match[2]) + dy;
        el.setAttribute('transform', `translate(${newTx}, ${newTy})`);
      } else {
        el.setAttribute('transform', `translate(${dx}, ${dy})`);
      }
    }
  }

  // ---- Transform helpers ----

  private applyRotation(shape: { element: SVGElement; rotation?: number }): void {
    const el = shape.element;
    const rotation = shape.rotation ?? 0;
    const bbox = (el as unknown as SVGGraphicsElement).getBBox();
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    let transform = el.getAttribute('transform') ?? '';
    transform = transform.replace(/rotate\([^)]*\)\s*/g, '').trim();
    if (rotation !== 0) {
      transform = `rotate(${rotation}, ${cx}, ${cy})` + (transform ? ' ' + transform : '');
    }
    if (transform) {
      el.setAttribute('transform', transform);
    } else {
      el.removeAttribute('transform');
    }
  }

  private applyResize(el: SVGElement, _type: string, origBBox: DOMRect, dx: number, dy: number, handle: string): void {
    let newX = origBBox.x;
    let newY = origBBox.y;
    let newW = origBBox.width;
    let newH = origBBox.height;

    if (handle.includes('e')) { newW += dx; }
    if (handle.includes('w')) { newX += dx; newW -= dx; }
    if (handle.includes('s')) { newH += dy; }
    if (handle.includes('n')) { newY += dy; newH -= dy; }

    if (newW < 1) newW = 1;
    if (newH < 1) newH = 1;

    const tag = el.tagName.toLowerCase();
    if (tag === 'rect') {
      el.setAttribute('x', String(newX));
      el.setAttribute('y', String(newY));
      el.setAttribute('width', String(newW));
      el.setAttribute('height', String(newH));
    } else if (tag === 'ellipse') {
      el.setAttribute('cx', String(newX + newW / 2));
      el.setAttribute('cy', String(newY + newH / 2));
      el.setAttribute('rx', String(newW / 2));
      el.setAttribute('ry', String(newH / 2));
    } else if (tag === 'line') {
      if (handle.includes('e') || handle.includes('s')) {
        el.setAttribute('x2', String(origBBox.x + origBBox.width + dx));
        el.setAttribute('y2', String(origBBox.y + origBBox.height + dy));
      }
      if (handle.includes('w') || handle.includes('n')) {
        el.setAttribute('x1', String(origBBox.x + dx));
        el.setAttribute('y1', String(origBBox.y + dy));
      }
    } else if (tag === 'text') {
      el.setAttribute('x', String(newX));
      el.setAttribute('y', String(newY + newH));
      const scaleFactor = newH / origBBox.height;
      const origFontSize = parseFloat(el.getAttribute('font-size') ?? '24');
      el.setAttribute('font-size', String(origFontSize * scaleFactor));
    } else if (tag === 'image' || tag === 'use') {
      el.setAttribute('x', String(newX));
      el.setAttribute('y', String(newY));
      el.setAttribute('width', String(newW));
      el.setAttribute('height', String(newH));
    }
  }
}
