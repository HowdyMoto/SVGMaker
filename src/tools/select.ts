import { BaseTool } from './base';
import type { Point, ShapeData } from '../core/types';
import { scalePathData } from '../core/path-model';
import { nudgeTranslate, setRotation, getRotation } from '../core/transform';

const NS = 'http://www.w3.org/2000/svg';

export class SelectTool extends BaseTool {
  name = 'select';

  // Drag-move state
  private dragging = false;
  private dragLastPt: Point = { x: 0, y: 0 };
  // Shapes being dragged, resolved once at drag start so the per-frame move
  // loop doesn't re-walk the shape tree (findShapeById is O(n)) every mousemove.
  private dragShapes: ShapeData[] = [];

  // Resize state
  private resizing = false;
  private resizeHandle = '';
  private resizeOrigBBox: DOMRect | null = null;
  private resizeStart: Point = { x: 0, y: 0 };
  // Original geometry (path `d` / poly `points`) captured at resize start, so
  // each mousemove scales from the original rather than compounding.
  private resizeOrigGeometry: string | null = null;
  // Original `transform` captured at resize start, used to scale groups (which
  // have no editable geometry) without compounding across mousemoves.
  private resizeOrigTransform: string | null = null;
  // Original text font-size captured at resize start, so font scaling is
  // computed from the start size rather than compounding every mousemove.
  private resizeOrigFontSize = 0;

  // Rotation state
  private rotating = false;
  private rotateCenter: Point = { x: 0, y: 0 };
  private rotateStartAngle = 0;
  private rotateOrigAngle = 0;
  // Local-space rotation pivot, snapshotted at rotate start. The geometry bbox
  // doesn't change while rotating, so this avoids a getBBox() reflow per frame.
  private rotatePivotLocal: Point | null = null;

  // Multi-transform state
  private multiOrigTransforms: Map<string, string> = new Map();
  private multiOrigBBoxes: Map<string, DOMRect> = new Map();
  private multiCombinedBBox: DOMRect | null = null;

  // Marquee (rubber-band) selection state
  private marquee = false;
  private marqueeStart: Point = { x: 0, y: 0 };
  private marqueeRect: SVGRectElement | null = null;

  onMouseDown(pt: Point, e: MouseEvent): void {
    // --- Handle click on resize/rotate handle ---
    const handle = (e.target as SVGElement).getAttribute?.('data-handle');
    if (handle && this.state.selectedShapeId) {
      const isMulti = this.state.selectedShapeIds.length > 1;
      const shapes = this.getSelectedShapes();

      // Snapshot original transforms for multi-transform operations
      if (isMulti) {
        this.multiOrigTransforms.clear();
        this.multiOrigBBoxes.clear();
        for (const s of shapes) {
          this.multiOrigTransforms.set(s.id, s.element.getAttribute('transform') ?? '');
          try {
            this.multiOrigBBoxes.set(s.id, (s.element as unknown as SVGGraphicsElement).getBBox());
          } catch { /* skip */ }
        }
        this.multiCombinedBBox = this.getScreenSpaceBBox(shapes);
      }

      if (handle === 'rotate') {
        this.rotating = true;
        this.state.setInteractive(true);
        if (isMulti) {
          const cb = this.multiCombinedBBox!;
          this.rotateCenter = { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 };
          this.rotateStartAngle = Math.atan2(pt.y - this.rotateCenter.y, pt.x - this.rotateCenter.x) * 180 / Math.PI;
          this.rotateOrigAngle = 0;
        } else {
          const shape = shapes[0];
          const bbox = (shape.element as unknown as SVGGraphicsElement).getBBox();
          this.rotateCenter = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
          this.rotatePivotLocal = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
          this.rotateStartAngle = Math.atan2(pt.y - this.rotateCenter.y, pt.x - this.rotateCenter.x) * 180 / Math.PI;
          this.rotateOrigAngle = shape.rotation ?? 0;
        }
        return;
      }

      this.resizing = true;
      this.state.setInteractive(true);
      this.resizeHandle = handle;
      this.resizeStart = { ...pt };
      this.resizeOrigGeometry = null;
      this.resizeOrigTransform = null;
      if (isMulti) {
        this.resizeOrigBBox = this.multiCombinedBBox!;
      } else {
        const el = shapes[0].element;
        this.resizeOrigBBox = (el as unknown as SVGGraphicsElement).getBBox();
        const tag = el.tagName.toLowerCase();
        if (tag === 'path') this.resizeOrigGeometry = el.getAttribute('d');
        else if (tag === 'polyline' || tag === 'polygon') this.resizeOrigGeometry = el.getAttribute('points');
        else if (tag === 'g') this.resizeOrigTransform = el.getAttribute('transform');
        else if (tag === 'text') this.resizeOrigFontSize = parseFloat(el.getAttribute('font-size') ?? '24');
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

      this.dragging = true;
      this.state.setInteractive(true);
      this.dragLastPt = { ...pt };
      // Resolve the dragged shapes once; reused every mousemove frame.
      this.dragShapes = this.state.selectedShapeIds
        .map(id => this.state.findShapeById(id))
        .filter((s): s is ShapeData => s !== null);
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
      const currentAngle = Math.atan2(pt.y - this.rotateCenter.y, pt.x - this.rotateCenter.x) * 180 / Math.PI;
      let deltaAngle = currentAngle - this.rotateStartAngle;
      if (e.shiftKey) {
        deltaAngle = Math.round((this.rotateOrigAngle + deltaAngle) / 15) * 15 - this.rotateOrigAngle;
      }
      deltaAngle = Math.round(deltaAngle * 10) / 10;

      if (this.state.selectedShapeIds.length > 1) {
        this.applyMultiRotation(deltaAngle);
      } else {
        const shape = this.state.getSelectedShape();
        if (!shape) return;
        shape.rotation = this.rotateOrigAngle + deltaAngle;
        this.applyRotation(shape, this.rotatePivotLocal ?? undefined);
      }
      this.state.onChange_public();
      return;
    }

    // --- Resize ---
    if (this.resizing && this.resizeOrigBBox) {
      let dx = pt.x - this.resizeStart.x;
      let dy = pt.y - this.resizeStart.y;
      // Shift on a corner handle keeps the selection's proportions.
      if (e.shiftKey) {
        const c = this.constrainProportional(dx, dy);
        dx = c.dx; dy = c.dy;
      }
      if (this.state.selectedShapeIds.length > 1) {
        this.applyMultiResize(dx, dy);
      } else {
        const shape = this.state.getSelectedShape();
        if (!shape) return;
        this.applyResize(shape.element, shape.type, this.resizeOrigBBox, dx, dy, this.resizeHandle);
      }
      this.state.onChange_public();
      return;
    }

    // --- Drag move (incremental translate) ---
    if (this.dragging) {
      const dx = pt.x - this.dragLastPt.x;
      const dy = pt.y - this.dragLastPt.y;
      if (dx !== 0 || dy !== 0) {
        for (const s of this.dragShapes) this.translateElement(s.element, dx, dy);
        this.dragLastPt = { ...pt };
        this.state.onChange_public();
      }
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
      this.resizeOrigGeometry = null;
      this.resizeOrigTransform = null;
      this.resizeOrigFontSize = 0;
      // Gesture done: leave interactive mode and do one full render so the side
      // panels catch up with the final geometry.
      this.state.setInteractive(false);
      this.state.onChange_public();
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


  // ---- Position helpers ----

  /** Move element by dx,dy in parent coordinate space. Works correctly for rotated elements. */
  private translateElement(el: SVGElement, dx: number, dy: number): void {
    const tag = el.tagName.toLowerCase();

    // Rotated elements (and groups/paths) move via the typed transform list so
    // any existing rotate/matrix is preserved and composed correctly.
    if (getRotation(el) !== 0 || tag === 'g' || tag === 'path') {
      nudgeTranslate(el, dx, dy);
      return;
    }

    // For non-rotated elements, adjust position attributes directly (more precise)
    if (tag === 'rect' || tag === 'text' || tag === 'image' || tag === 'use') {
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
    }
  }


  // ---- Screen-space bbox (accounts for transforms) ----

  private getScreenSpaceBBox(shapes: ShapeData[]): DOMRect {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const svgEl = this.svgCanvas;
    const drawingLayer = svgEl.querySelector('#drawing-layer') as SVGGraphicsElement | null;
    const parentCtm = drawingLayer?.getCTM?.();

    for (const s of shapes) {
      const el = s.element as unknown as SVGGraphicsElement;
      try {
        const bbox = el.getBBox();
        const ctm = el.getCTM();
        if (ctm && parentCtm) {
          const m = parentCtm.inverse().multiply(ctm);
          for (const c of [
            { x: bbox.x, y: bbox.y },
            { x: bbox.x + bbox.width, y: bbox.y },
            { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
            { x: bbox.x, y: bbox.y + bbox.height },
          ]) {
            const pt = svgEl.createSVGPoint();
            pt.x = c.x; pt.y = c.y;
            const t = pt.matrixTransform(m);
            minX = Math.min(minX, t.x);
            minY = Math.min(minY, t.y);
            maxX = Math.max(maxX, t.x);
            maxY = Math.max(maxY, t.y);
          }
        } else {
          minX = Math.min(minX, bbox.x);
          minY = Math.min(minY, bbox.y);
          maxX = Math.max(maxX, bbox.x + bbox.width);
          maxY = Math.max(maxY, bbox.y + bbox.height);
        }
      } catch { /* skip */ }
    }
    return new DOMRect(minX, minY, maxX - minX, maxY - minY);
  }

  // ---- Multi-transform operations ----

  private applyMultiRotation(deltaAngle: number): void {
    const cx = this.rotateCenter.x;
    const cy = this.rotateCenter.y;
    const rad = deltaAngle * Math.PI / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    for (const s of this.getSelectedShapes()) {
      const origTransform = this.multiOrigTransforms.get(s.id) ?? '';
      const origBBox = this.multiOrigBBoxes.get(s.id);
      if (!origBBox) continue;

      // Element center in local space
      const ex = origBBox.x + origBBox.width / 2;
      const ey = origBBox.y + origBBox.height / 2;

      // Rotate element center around the group center
      const dx = ex - cx;
      const dy = ey - cy;
      const newCx = cx + dx * cosA - dy * sinA;
      const newCy = cy + dx * sinA + dy * cosA;
      const tx = newCx - ex;
      const ty = newCy - ey;

      // Build new transform: translate to new position + rotate by delta + original transform
      let newTransform = '';
      if (tx !== 0 || ty !== 0) newTransform += `translate(${tx}, ${ty}) `;
      newTransform += `rotate(${deltaAngle}, ${ex}, ${ey})`;
      if (origTransform) newTransform += ` ${origTransform}`;

      s.element.setAttribute('transform', newTransform.trim());

      // Update shape rotation tracking
      const origRotMatch = origTransform.match(/rotate\(([-\d.]+)/);
      const origRot = origRotMatch ? parseFloat(origRotMatch[1]) : 0;
      s.rotation = origRot + deltaAngle;
    }
  }

  private applyMultiResize(dx: number, dy: number): void {
    const orig = this.resizeOrigBBox;
    if (!orig || orig.width === 0 || orig.height === 0) return;

    // Compute new combined bbox from handle drag
    let newX = orig.x, newY = orig.y, newW = orig.width, newH = orig.height;
    const handle = this.resizeHandle;
    if (handle.includes('e')) newW += dx;
    if (handle.includes('w')) { newX += dx; newW -= dx; }
    if (handle.includes('s')) newH += dy;
    if (handle.includes('n')) { newY += dy; newH -= dy; }
    if (newW < 1) newW = 1;
    if (newH < 1) newH = 1;

    const sx = newW / orig.width;
    const sy = newH / orig.height;

    // Anchor point (opposite corner of the handle)
    const ax = handle.includes('w') ? orig.x + orig.width : orig.x;
    const ay = handle.includes('n') ? orig.y + orig.height : orig.y;

    for (const s of this.getSelectedShapes()) {
      const origTransform = this.multiOrigTransforms.get(s.id) ?? '';
      const origBBox = this.multiOrigBBoxes.get(s.id);
      if (!origBBox) continue;

      const ex = origBBox.x + origBBox.width / 2;
      const ey = origBBox.y + origBBox.height / 2;

      // Scale position relative to anchor
      const scaledCx = ax + (ex - ax) * sx;
      const scaledCy = ay + (ey - ay) * sy;
      const tx = scaledCx - ex;
      const ty = scaledCy - ey;

      let newTransform = '';
      if (tx !== 0 || ty !== 0) newTransform += `translate(${tx}, ${ty}) `;
      newTransform += `scale(${sx}, ${sy})`;
      if (origTransform) newTransform += ` ${origTransform}`;

      s.element.setAttribute('transform', newTransform.trim());
    }
  }

  // ---- Transform helpers ----

  /**
   * Constrain a corner-handle drag so the selection scales uniformly (locks
   * aspect ratio). The axis dragged farther (proportionally) drives the scale;
   * the other follows. Edge handles are returned unchanged.
   */
  private constrainProportional(dx: number, dy: number): { dx: number; dy: number } {
    const bb = this.resizeOrigBBox;
    const h = this.resizeHandle;
    if (!bb || bb.width <= 0 || bb.height <= 0) return { dx, dy };
    const hasE = h.includes('e'), hasW = h.includes('w'), hasN = h.includes('n'), hasS = h.includes('s');
    if (!((hasE || hasW) && (hasN || hasS))) return { dx, dy }; // corners only

    // Signed growth of width/height implied by the drag.
    let dW = hasE ? dx : -dx;
    let dH = hasS ? dy : -dy;
    const rel = Math.abs(dW / bb.width) >= Math.abs(dH / bb.height) ? dW / bb.width : dH / bb.height;
    dW = rel * bb.width;
    dH = rel * bb.height;
    return { dx: hasE ? dW : -dW, dy: hasS ? dH : -dH };
  }

  private applyRotation(shape: { element: SVGElement; rotation?: number }, pivot?: Point): void {
    const el = shape.element;
    let cx = pivot?.x;
    let cy = pivot?.y;
    if (cx === undefined || cy === undefined) {
      const bbox = (el as unknown as SVGGraphicsElement).getBBox();
      cx = bbox.x + bbox.width / 2;
      cy = bbox.y + bbox.height / 2;
    }
    setRotation(el, shape.rotation ?? 0, cx, cy);
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

    // Paths and polylines/polygons: scale their baked-in geometry about the
    // fixed (opposite) corner, recomputed from the original captured at start.
    if ((tag === 'path' || tag === 'polyline' || tag === 'polygon') && this.resizeOrigGeometry !== null) {
      const sx = origBBox.width !== 0 ? newW / origBBox.width : 1;
      const sy = origBBox.height !== 0 ? newH / origBBox.height : 1;
      const fx = handle.includes('w') ? origBBox.x + origBBox.width : origBBox.x;
      const fy = handle.includes('n') ? origBBox.y + origBBox.height : origBBox.y;
      if (tag === 'path') {
        el.setAttribute('d', scalePathData(this.resizeOrigGeometry, fx, fy, sx, sy));
      } else {
        const pts = this.resizeOrigGeometry.trim().split(/\s+/).map(p => {
          const [px, py] = p.split(',').map(Number);
          return `${fx + (px - fx) * sx},${fy + (py - fy) * sy}`;
        }).join(' ');
        el.setAttribute('points', pts);
      }
      return;
    }

    // Groups have no editable geometry: scale them about the fixed corner via a
    // transform composed in front of the group's original transform (captured
    // once at start). Lets a group selected on the canvas be resized as a unit.
    if (tag === 'g') {
      const sx = origBBox.width !== 0 ? newW / origBBox.width : 1;
      const sy = origBBox.height !== 0 ? newH / origBBox.height : 1;
      const fx = handle.includes('w') ? origBBox.x + origBBox.width : origBBox.x;
      const fy = handle.includes('n') ? origBBox.y + origBBox.height : origBBox.y;
      const tx = fx * (1 - sx);
      const ty = fy * (1 - sy);
      const orig = this.resizeOrigTransform ? this.resizeOrigTransform + ' ' : '';
      el.setAttribute('transform', `${orig}translate(${tx}, ${ty}) scale(${sx}, ${sy})`);
      return;
    }

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
      // Scale from the size captured at resize start, not the live (already
      // scaled) size — otherwise each mousemove compounds and the text explodes.
      const scaleFactor = origBBox.height !== 0 ? newH / origBBox.height : 1;
      el.setAttribute('font-size', String(this.resizeOrigFontSize * scaleFactor));
    } else if (tag === 'image' || tag === 'use') {
      el.setAttribute('x', String(newX));
      el.setAttribute('y', String(newY));
      el.setAttribute('width', String(newW));
      el.setAttribute('height', String(newH));
    }
  }
}
