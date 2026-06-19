import { BaseTool } from './base';
import type { Point } from '../core/types';
import type { AnchorRef, HandleHit } from '../core/path-edit';

/**
 * Direct Selection tool (Illustrator's white arrow). Clicking a path enters a
 * node-editing session; anchors and handles can then be selected, moved, and
 * deleted. Handle drags respect the anchor's type (smooth mirrors, broken/Alt
 * is independent). Geometry round-trips through the shared {@link PathEditSession}.
 */
export class NodeEditTool extends BaseTool {
  name = 'directSelect';

  private dragAnchor: AnchorRef | null = null;
  private dragHandle: HandleHit | null = null;
  private dragAlt = false;
  private dragLast: Point = { x: 0, y: 0 };
  private dirty = false;

  // Rubber-band node selection (coords in svg-user / viewBox space).
  private marquee = false;
  private marqueeStart: Point = { x: 0, y: 0 };
  private marqueeMoved = false;
  private marqueeAdditive = false;
  private marqueeFromEmpty = false;
  private marqueeRect: SVGRectElement | null = null;

  activate(): void {
    // If a single path is already selected, jump straight into editing it.
    const sel = this.state.getSelectedShape();
    if (sel && sel.type === 'path') this.state.enterPathEdit(sel.id);
  }

  deactivate(): void {
    if (this.dirty) this.state.commitPathEdit();
    this.resetDrag();
    this.state.exitPathEdit();
  }

  onMouseDown(pt: Point, e: MouseEvent): void {
    const editingEl = this.editingElement();

    // Not editing yet: clicking a path enters edit; otherwise plain-select.
    if (!editingEl || !this.state.pathEdit) {
      const el = this.findShapeElement(e.target as SVGElement);
      const shape = el ? this.state.findShapeById(el.id) : null;
      if (shape && shape.type === 'path') this.state.enterPathEdit(shape.id);
      else this.state.selectShape(el?.id ?? null);
      return;
    }

    const session = this.state.pathEdit;
    const local = this.toLocal(pt);
    const tol = this.tolerance();

    // 1) Control handle of a selected anchor.
    const h = session.hitHandle(local.x, local.y, tol * 1.3);
    if (h) {
      this.dragHandle = h;
      this.dragAlt = e.altKey;
      this.state.setInteractive(true);
      return;
    }

    // 2) Anchor.
    const a = session.hitAnchor(local.x, local.y, tol);
    if (a) {
      if (e.shiftKey) session.toggleSelect(a.sp, a.i);
      else if (!session.isSelected(a.sp, a.i)) session.selectOnly(a.sp, a.i);
      this.dragAnchor = a;
      this.dragLast = local;
      this.state.setInteractive(true);
      this.state.onChange_public();
      return;
    }

    // 3) Clicked a DIFFERENT shape: switch to editing/selecting it.
    const el = this.findShapeElement(e.target as SVGElement);
    if (el && el.id !== this.state.editingPathId) {
      const shape = this.state.findShapeById(el.id);
      if (shape && shape.type === 'path') {
        this.state.enterPathEdit(shape.id);
      } else if (shape) {
        this.state.exitPathEdit();
        this.state.selectShape(shape.id);
      }
      return;
    }

    // 4) On the editing path's body or empty space: begin a rubber-band select.
    // A drag selects the enclosed nodes; a plain click (no drag) clears the
    // node selection — or, from empty space, exits the path (handled on mouseup).
    this.marquee = true;
    this.marqueeStart = { ...pt };
    this.marqueeMoved = false;
    this.marqueeAdditive = e.shiftKey;
    this.marqueeFromEmpty = !el;
  }

  onMouseMove(pt: Point, e: MouseEvent): void {
    const session = this.state.pathEdit;
    if (!session) return;

    if (this.marquee) {
      const t = 3 / this.canvas.getZoom(); // ~3px drag threshold before it counts
      if (!this.marqueeMoved &&
          (Math.abs(pt.x - this.marqueeStart.x) > t || Math.abs(pt.y - this.marqueeStart.y) > t)) {
        this.marqueeMoved = true;
        this.createMarqueeRect();
      }
      if (this.marqueeMoved) this.updateMarqueeRect(pt);
      return;
    }

    const local = this.toLocal(pt);

    if (this.dragHandle) {
      const { sp, i, which } = this.dragHandle;
      session.moveHandle(sp, i, which, local.x, local.y, this.dragAlt || e.altKey);
      this.livePreview();
      return;
    }
    if (this.dragAnchor) {
      const dx = local.x - this.dragLast.x;
      const dy = local.y - this.dragLast.y;
      if (dx !== 0 || dy !== 0) {
        session.moveSelected(dx, dy);
        this.dragLast = local;
        this.livePreview();
      }
    }
  }

  onMouseUp(pt: Point, _e: MouseEvent): void {
    if (this.marquee) {
      const moved = this.marqueeMoved;
      this.removeMarqueeRect();
      this.marquee = false;
      this.marqueeMoved = false;
      if (moved) this.selectNodesInRect(pt);
      else this.handleMarqueeClick();
      return;
    }
    const wasDragging = !!(this.dragHandle || this.dragAnchor);
    if (wasDragging) this.state.setInteractive(false); // before commit, so it renders fully
    if (this.dirty) this.state.commitPathEdit();
    this.resetDrag();
    if (wasDragging) this.state.onChange_public();
  }

  onKeyDown(e: KeyboardEvent): void {
    const session = this.state.pathEdit;
    if (!session) return;
    if (e.key === 'Escape') { this.state.exitPathEdit(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (session.selected.size > 0 && session.deleteSelected()) {
        this.state.commitPathEdit();
      }
    }
  }

  // ---- helpers ----

  private livePreview(): void {
    const session = this.state.pathEdit;
    const el = this.editingElement();
    if (!session || !el) return;
    el.setAttribute('d', session.commit());
    this.dirty = true;
    this.state.onChange_public();
  }

  private resetDrag(): void {
    this.dragAnchor = null;
    this.dragHandle = null;
    this.dragAlt = false;
    this.dirty = false;
    this.marquee = false;
    this.marqueeMoved = false;
    this.removeMarqueeRect();
  }

  // ---- node marquee selection ----

  /** A click (no drag): clear the node selection, or exit if from empty space. */
  private handleMarqueeClick(): void {
    const session = this.state.pathEdit;
    if (!session) return;
    if (this.marqueeFromEmpty) {
      this.state.exitPathEdit();
      this.state.selectShape(null);
    } else {
      session.clearSelection();
      this.state.onChange_public();
    }
  }

  /** Select every anchor whose point falls inside the dragged rectangle. */
  private selectNodesInRect(end: Point): void {
    const session = this.state.pathEdit;
    if (!session) return;
    const a = this.toLocal(this.marqueeStart);
    const b = this.toLocal(end);
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
    if (!this.marqueeAdditive) session.clearSelection();
    session.model.subpaths.forEach((sp, spi) => {
      sp.anchors.forEach((an, i) => {
        if (an.x >= minX && an.x <= maxX && an.y >= minY && an.y <= maxY) session.addSelect(spi, i);
      });
    });
    this.state.onChange_public();
  }

  private selectionLayer(): SVGGElement | null {
    return this.svgCanvas.querySelector('#selection-layer');
  }

  private createMarqueeRect(): void {
    const layer = this.selectionLayer();
    if (!layer) return;
    const rect = document.createElementNS(this.NS, 'rect') as SVGRectElement;
    rect.id = 'marquee-rect';
    rect.setAttribute('fill', 'rgba(32, 160, 255, 0.08)');
    rect.setAttribute('stroke', '#20a0ff');
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('vector-effect', 'non-scaling-stroke');
    rect.setAttribute('stroke-dasharray', '4,3');
    rect.setAttribute('pointer-events', 'none');
    layer.appendChild(rect);
    this.marqueeRect = rect;
  }

  private updateMarqueeRect(pt: Point): void {
    if (!this.marqueeRect) return;
    const x = Math.min(pt.x, this.marqueeStart.x);
    const y = Math.min(pt.y, this.marqueeStart.y);
    this.marqueeRect.setAttribute('x', String(x));
    this.marqueeRect.setAttribute('y', String(y));
    this.marqueeRect.setAttribute('width', String(Math.abs(pt.x - this.marqueeStart.x)));
    this.marqueeRect.setAttribute('height', String(Math.abs(pt.y - this.marqueeStart.y)));
  }

  private removeMarqueeRect(): void {
    this.marqueeRect?.remove();
    this.marqueeRect = null;
  }

  private editingElement(): SVGElement | null {
    if (!this.state.editingPathId) return null;
    return this.state.findShapeById(this.state.editingPathId)?.element ?? null;
  }

  /** Pixel hit tolerance converted to the path's local units. */
  private tolerance(): number {
    return 7 / this.canvas.getZoom();
  }

  /**
   * Convert an svg-user-space point (from canvas.screenToSVG, i.e. viewBox
   * coordinates) to the editing element's local space. Mapping relative to the
   * drawing layer cancels the viewBox offset that getCTM() bakes in.
   */
  private toLocal(pt: Point): Point {
    const el = this.editingElement() as unknown as SVGGraphicsElement | null;
    const drawing = this.svgCanvas.querySelector('#drawing-layer') as unknown as SVGGraphicsElement | null;
    const elCtm = el?.getCTM?.();
    const parentCtm = drawing?.getCTM?.();
    if (!elCtm || !parentCtm) return pt;
    const m = parentCtm.inverse().multiply(elCtm); // local -> drawing-layer (user) space
    const p = this.svgCanvas.createSVGPoint();
    p.x = pt.x; p.y = pt.y;
    const local = p.matrixTransform(m.inverse());
    return { x: local.x, y: local.y };
  }

  private findShapeElement(target: SVGElement | null): SVGElement | null {
    let el: SVGElement | null = target;
    let topShape: SVGElement | null = null;
    while (el) {
      if (el.id && el.id.startsWith('shape-')) topShape = el;
      if (el.id === 'drawing-layer') break;
      el = el.parentElement as SVGElement | null;
    }
    return topShape;
  }
}
