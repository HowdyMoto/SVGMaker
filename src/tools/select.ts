import { BaseTool } from './base';
import type { Point } from '../core/types';

export class SelectTool extends BaseTool {
  name = 'select';
  private dragging = false;
  private dragStart: Point = { x: 0, y: 0 };
  private origPos: { x: number; y: number } | null = null;
  private resizing = false;
  private resizeHandle = '';
  private resizeOrigBBox: DOMRect | null = null;
  private resizeStart: Point = { x: 0, y: 0 };

  onMouseDown(pt: Point, e: MouseEvent): void {
    // Check if clicking on a resize handle
    const handle = (e.target as SVGElement).getAttribute?.('data-handle');
    if (handle && this.state.selectedShapeId) {
      this.resizing = true;
      this.resizeHandle = handle;
      this.resizeStart = { ...pt };
      const shape = this.state.getSelectedShape();
      if (shape) {
        this.resizeOrigBBox = (shape.element as unknown as SVGGraphicsElement).getBBox();
      }
      return;
    }

    // Check if clicking on a shape
    const target = e.target as SVGElement;
    const shapeEl = this.findShapeElement(target);

    if (shapeEl) {
      this.state.selectShape(shapeEl.id);
      this.dragging = true;
      this.dragStart = { ...pt };
      this.origPos = this.getElementPos(shapeEl);
    } else {
      // Check if clicking on canvas background or grid
      const isCanvas = target.id === 'canvas-bg' || target.id === 'canvas-grid' ||
        target.closest('#canvas-bg') !== null || target.closest('#canvas-grid') !== null;
      if (isCanvas) {
        // Start panning with middle click or space
        if (e.button === 1) {
          this.canvas.startPan(e.clientX, e.clientY);
        } else {
          this.state.selectShape(null);
        }
      }
    }
  }

  onMouseMove(pt: Point, _e: MouseEvent): void {
    if (this.resizing && this.resizeOrigBBox) {
      const shape = this.state.getSelectedShape();
      if (!shape) return;
      const dx = pt.x - this.resizeStart.x;
      const dy = pt.y - this.resizeStart.y;
      const bbox = this.resizeOrigBBox;
      this.applyResize(shape.element, shape.type, bbox, dx, dy, this.resizeHandle);
      this.state.onChange_public();
      return;
    }

    if (this.dragging && this.origPos) {
      const shape = this.state.getSelectedShape();
      if (!shape) return;
      const dx = pt.x - this.dragStart.x;
      const dy = pt.y - this.dragStart.y;
      this.moveElement(shape.element, shape.type, this.origPos.x + dx, this.origPos.y + dy);
      this.state.onChange_public();
    }
  }

  onMouseUp(_pt: Point, _e: MouseEvent): void {
    if (this.dragging || this.resizing) {
      this.state.saveHistory();
      this.dragging = false;
      this.resizing = false;
      this.resizeOrigBBox = null;
    }
    this.canvas.endPan();
  }

  private findShapeElement(target: SVGElement): SVGElement | null {
    let el: SVGElement | null = target;
    while (el) {
      if (el.id && el.id.startsWith('shape-')) return el;
      el = el.parentElement as SVGElement | null;
    }
    return null;
  }

  private getElementPos(el: SVGElement): { x: number; y: number } {
    const tag = el.tagName.toLowerCase();
    if (tag === 'rect' || tag === 'text') {
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
    if (tag === 'rect' || (tag === 'text' && type === 'text')) {
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
      const origX = x1;
      const origY = y1;
      const dx = x - origX;
      const dy = y - origY;
      el.setAttribute('x1', String(x1 + dx));
      el.setAttribute('y1', String(y1 + dy));
      el.setAttribute('x2', String(x2 + dx));
      el.setAttribute('y2', String(y2 + dy));
    } else if (tag === 'polyline' || tag === 'polygon') {
      const points = el.getAttribute('points') ?? '';
      const pairs = points.trim().split(/\s+/).map(p => p.split(',').map(Number));
      if (pairs.length === 0) return;
      const origX = pairs[0][0];
      const origY = pairs[0][1];
      const dx = x - origX;
      const dy = y - origY;
      const newPoints = pairs.map(([px, py]) => `${px + dx},${py + dy}`).join(' ');
      el.setAttribute('points', newPoints);
    } else if (tag === 'path') {
      // Use transform for paths
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
    }
  }
}
