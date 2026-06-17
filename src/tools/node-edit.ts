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
      return;
    }

    // 2) Anchor.
    const a = session.hitAnchor(local.x, local.y, tol);
    if (a) {
      if (e.shiftKey) session.toggleSelect(a.sp, a.i);
      else if (!session.isSelected(a.sp, a.i)) session.selectOnly(a.sp, a.i);
      this.dragAnchor = a;
      this.dragLast = local;
      this.state.onChange_public();
      return;
    }

    // 3) Clicked elsewhere.
    const el = this.findShapeElement(e.target as SVGElement);
    if (el && el.id === this.state.editingPathId) {
      // On the editing path's body but not a node: clear node selection.
      session.clearSelection();
      this.state.onChange_public();
      return;
    }
    const shape = el ? this.state.findShapeById(el.id) : null;
    if (shape && shape.type === 'path') {
      this.state.enterPathEdit(shape.id);
    } else if (shape) {
      this.state.exitPathEdit();
      this.state.selectShape(shape.id);
    } else {
      this.state.exitPathEdit();
      this.state.selectShape(null);
    }
  }

  onMouseMove(pt: Point, e: MouseEvent): void {
    const session = this.state.pathEdit;
    if (!session) return;
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

  onMouseUp(_pt: Point, _e: MouseEvent): void {
    if (this.dirty) this.state.commitPathEdit();
    this.resetDrag();
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
