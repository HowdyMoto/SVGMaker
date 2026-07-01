import { tokens } from '../ui/tokens';
import { BaseTool } from './base';
import type { Point, ShapeData, BBox } from '../core/types';
import { scalePathData } from '../core/path-model';
import { nudgeTranslate, setRotation, getRotation } from '../core/transform';
import {
  collectSnapTargets, computeSnap, computeResizeSnap,
  drawSnapGuides, clearSnapGuides, SNAP_PX,
  type SnapTargets,
} from '../core/snapping';
import { showGestureHud, hideGestureHud } from '../ui/gesture-hud';
import { hideGroupHint } from '../ui/group-hint';

const NS = 'http://www.w3.org/2000/svg';

export class SelectTool extends BaseTool {
  name = 'select';

  // Drag-move state
  private dragging = false;
  // Shapes being dragged, resolved once at drag start so the per-frame move
  // loop doesn't re-walk the shape tree (findShapeById is O(n)) every mousemove.
  private dragShapes: ShapeData[] = [];

  // Smart-guide (snapping) state, captured once at gesture start. Drag uses an
  // absolute-from-origin model (dragStartPt/BBox + appliedDx/Dy) so snapping can
  // align to absolute target lines and we re-derive the incremental translate.
  private dragStartPt: Point = { x: 0, y: 0 };
  private dragStartBBox: BBox | null = null;
  private appliedDx = 0;
  private appliedDy = 0;
  private snapTargets: SnapTargets | null = null;
  private _guidesLayer: SVGGElement | null = null;

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

  // Corner-radius drag state (rounded-rect live corner handles)
  private radiusing = false;
  private radiusHandle = '';
  private radiusOrigBBox: DOMRect | null = null;

  // Multi-transform state
  private multiOrigTransforms: Map<string, string> = new Map();
  private multiOrigBBoxes: Map<string, DOMRect> = new Map();
  private multiCombinedBBox: DOMRect | null = null;

  // Marquee (rubber-band) selection state
  private marquee = false;
  private marqueeStart: Point = { x: 0, y: 0 };
  private marqueeRect: SVGRectElement | null = null;

  private get guidesLayer(): SVGGElement {
    if (!this._guidesLayer) {
      this._guidesLayer = this.svgCanvas.querySelector('#guides-layer') as SVGGElement;
    }
    return this._guidesLayer;
  }

  /** Capture the snap baseline at drag start: origin point, the combined bbox of
   *  the dragged shapes, and the snap targets (artboard + other objects). */
  private initDragSnap(pt: Point): void {
    this.dragStartPt = { ...pt };
    this.appliedDx = 0;
    this.appliedDy = 0;
    this.dragStartBBox = this.getScreenSpaceBBox(this.dragShapes);
    const movingIds = new Set(this.dragShapes.map(s => s.id));
    this.snapTargets = collectSnapTargets(this.state, movingIds, this.svgCanvas);
  }

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

      if (handle.startsWith('radius-')) {
        // Live corner-radius drag — single rounded-rect only.
        this.radiusing = true;
        this.state.setInteractive(true);
        this.radiusHandle = handle;
        this.radiusOrigBBox = (shapes[0].element as unknown as SVGGraphicsElement).getBBox();
        return;
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
      this.snapTargets = collectSnapTargets(
        this.state, new Set(this.state.selectedShapeIds), this.svgCanvas,
      );
      return;
    }

    // --- Check if clicking on a shape ---
    const target = e.target as SVGElement;

    // If you press on something that's already selected, drag the CURRENT
    // selection as-is instead of re-resolving the click to a group. Without this,
    // selecting a subset of a group's children (e.g. in the Layers panel) and
    // dragging would collapse to "the whole group" and move every sibling. Also
    // lets a single child picked in the panel be moved without a double-click.
    // Shift/Alt keep their normal roles (extend selection / reach a child).
    if (!e.shiftKey && !e.altKey && this.state.selectedShapeIds.length >= 1) {
      const selected = this.getSelectedShapes();
      const pressedSelected = selected.some(s => s.element.contains(target));
      // Only short-circuit when it changes the outcome: a multi-selection, or a
      // single nested child (whose click would otherwise resolve to its group).
      if (pressedSelected && (selected.length > 1 || !!selected[0]?.parentId)) {
        this.dragging = true;
        this.state.setInteractive(true);
        this.dragShapes = selected;
        this.initDragSnap(pt);
        return;
      }
    }

    const deep = e.altKey && !e.shiftKey; // Alt-click reaches the child directly
    let shapeEl = this.findShapeElement(target, { deep });

    // Clicking outside the entered group leaves isolation, then re-resolves at
    // the top level so the click selects whatever was actually hit.
    if (this.state.activeGroupId && shapeEl && !this.isInActiveGroup(shapeEl)) {
      this.state.exitGroupIsolation();
      shapeEl = this.findShapeElement(target, { deep });
    }

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
      // Resolve the dragged shapes once; reused every mousemove frame.
      this.dragShapes = this.state.selectedShapeIds
        .map(id => this.state.findShapeById(id))
        .filter((s): s is ShapeData => s !== null);
      this.initDragSnap(pt);
    } else {
      // Clicked on empty space
      const isCanvas = target.id === 'canvas-bg' || target.id === 'canvas-grid' ||
        target.closest('#canvas-bg') !== null || target.closest('#canvas-grid') !== null ||
        target.closest('#artboards-layer') !== null || target.id === 'pasteboard';

      if (isCanvas) {
        // Clicking empty canvas leaves group isolation.
        this.state.exitGroupIsolation();
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

    // --- Corner radius ---
    if (this.radiusing && this.radiusOrigBBox) {
      const shape = this.state.getSelectedShape();
      if (!shape) return;
      const bb = this.radiusOrigBBox;
      const corner = this.radiusHandle.slice(7); // 'radius-' is 7 chars
      // Inward distance from the dragged corner along each axis (best-fit radius
      // is the average, so the handle tracks the cursor down the diagonal).
      const sx = corner.includes('w') ? pt.x - bb.x : (bb.x + bb.width) - pt.x;
      const sy = corner.includes('n') ? pt.y - bb.y : (bb.y + bb.height) - pt.y;
      const maxR = Math.min(bb.width, bb.height) / 2;
      let r = Math.max(0, Math.min((sx + sy) / 2, maxR));
      r = Math.round(r * 10) / 10;
      shape.element.setAttribute('rx', String(r));
      shape.element.removeAttribute('ry'); // keep corners uniform
      shape.style.rx = r;
      this.state.onChange_public();
      return;
    }

    // --- Rotation ---
    if (this.rotating) {
      showGestureHud('rotate', e);
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
      showGestureHud('resize', e);
      let dx = pt.x - this.resizeStart.x;
      let dy = pt.y - this.resizeStart.y;
      // Shift on a corner handle keeps the selection's proportions.
      if (e.shiftKey) {
        const c = this.constrainProportional(dx, dy);
        dx = c.dx; dy = c.dy;
      }
      // Smart-guide snapping of the dragged edge(s). Skipped under Shift, where
      // it would fight the locked aspect ratio; bypassed while ⌘/Ctrl is held.
      const snapResize = this.state.snapEnabled && !(e.metaKey || e.ctrlKey) && !e.shiftKey;
      if (snapResize && this.snapTargets) {
        const r = computeResizeSnap(
          this.resizeOrigBBox, dx, dy, this.resizeHandle,
          this.snapTargets, SNAP_PX / this.canvas.getZoom(),
        );
        dx = r.dx; dy = r.dy;
        drawSnapGuides(this.guidesLayer, r.guides);
      } else {
        clearSnapGuides(this.guidesLayer);
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

    // --- Drag move (snap-aware, absolute-from-origin) ---
    if (this.dragging) {
      showGestureHud('move', e);
      const rawDx = pt.x - this.dragStartPt.x;
      const rawDy = pt.y - this.dragStartPt.y;
      let totalDx = rawDx, totalDy = rawDy;

      // Snap on by default; hold ⌘/Ctrl to bypass, off via View → Smart Guides.
      const snapOn = this.state.snapEnabled && !(e.metaKey || e.ctrlKey);
      if (snapOn && this.dragStartBBox && this.snapTargets) {
        const moving: BBox = {
          x: this.dragStartBBox.x + rawDx,
          y: this.dragStartBBox.y + rawDy,
          width: this.dragStartBBox.width,
          height: this.dragStartBBox.height,
        };
        const snap = computeSnap(moving, this.snapTargets, SNAP_PX / this.canvas.getZoom());
        totalDx += snap.dx;
        totalDy += snap.dy;
        drawSnapGuides(this.guidesLayer, snap.guides);
      } else {
        clearSnapGuides(this.guidesLayer);
      }

      // Shift constrains the move to a straight horizontal/vertical line, locking
      // whichever axis the pointer has travelled less along. Applied after snap so
      // the locked axis stays exactly on its origin.
      if (e.shiftKey) {
        if (Math.abs(rawDx) >= Math.abs(rawDy)) totalDy = 0;
        else totalDx = 0;
      }

      // Re-derive the incremental delta to feed translateElement().
      const incDx = totalDx - this.appliedDx;
      const incDy = totalDy - this.appliedDy;
      if (incDx !== 0 || incDy !== 0) {
        for (const s of this.dragShapes) this.translateElement(s.element, incDx, incDy);
        this.appliedDx = totalDx;
        this.appliedDy = totalDy;
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

    if (this.dragging || this.resizing || this.rotating || this.radiusing) {
      this.state.saveHistory();
      this.dragging = false;
      this.resizing = false;
      this.rotating = false;
      this.radiusing = false;
      this.radiusOrigBBox = null;
      this.resizeOrigBBox = null;
      this.resizeOrigGeometry = null;
      this.resizeOrigTransform = null;
      this.resizeOrigFontSize = 0;
      // Clear smart-guide overlay and snap baseline; dismiss the gesture HUD.
      clearSnapGuides(this.guidesLayer);
      hideGestureHud();
      this.snapTargets = null;
      this.dragStartBBox = null;
      // Gesture done: leave interactive mode and do one full render so the side
      // panels catch up with the final geometry.
      this.state.setInteractive(false);
      this.state.onChange_public();
    }
    this.canvas.endPan();
  }

  /**
   * Double-click drills one level toward the clicked shape: it enters the group
   * currently selectable under the cursor (Adobe-style isolation) and selects
   * that group's child on the click path. Repeated double-clicks descend deeper;
   * double-clicking empty canvas exits isolation.
   */
  onDoubleClick(_pt: Point, e: MouseEvent): void {
    const target = e.target as SVGElement;
    const chain = this.shapeChain(target);
    if (chain.length === 0) { this.state.exitGroupIsolation(); return; }

    const deepest = chain[0];
    const current = this.findShapeElement(target); // selectable element at this level
    if (!current) { this.state.exitGroupIsolation(); return; }

    // A live boolean reads as a leaf (operands are hidden), but double-click should
    // enter it for operand editing rather than just re-selecting the result.
    if (this.state.findShapeById(current.id)?.type === 'boolean') {
      this.state.enterGroup(current.id);
      this.state.selectShape(null);
      return;
    }

    // Already at the leaf — nothing deeper to enter; just select it.
    if (current === deepest) { this.state.selectShape(current.id); return; }

    // `current` is a group with deeper content on the path: enter it and select
    // the next level down.
    if (this.state.findShapeById(current.id)?.type === 'group') {
      this.state.enterGroup(current.id);
      const child = this.findShapeElement(target); // now scoped one level deeper
      this.state.selectShape(child && child !== current ? child.id : current.id);
    } else {
      this.state.selectShape(current.id);
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    const g = this.state.activeGroupId;
    if (!g) return; // not inside a group — nothing to step out of

    // Step up one level: select the group we were editing inside (clear visual
    // feedback — the selection jumps from the child to the whole group), and move
    // isolation to that group's own parent so a further Esc steps up again.
    const parentId = this.state.findShapeById(g)?.parentId ?? null;
    this.state.selectShape(g);
    if (parentId) this.state.enterGroup(parentId);
    else this.state.exitGroupIsolation();
  }

  deactivate(): void {
    // The group hint is a Select-tool affordance; don't let it linger when the
    // user switches to another tool (tool changes don't re-render the overlay).
    hideGroupHint();
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
    rect.setAttribute('stroke', tokens.selectionAccent);
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

  /** The chain of `shape-*` ancestors of `target`, innermost first, up to (and
   *  not past) #drawing-layer. Empty when the click isn't on a shape. */
  private shapeChain(target: SVGElement): SVGElement[] {
    const chain: SVGElement[] = [];
    let el: SVGElement | null = target;
    while (el) {
      if (el.id && el.id.startsWith('shape-')) chain.push(el);
      if (el.id === 'drawing-layer') break;
      el = el.parentElement as SVGElement | null;
    }
    return chain;
  }

  /**
   * Resolve a click target to the shape it should select. By default this is the
   * outermost group (top of the z-stack), so a group drags as a unit. Two things
   * change that:
   *  - `opts.deep` (Alt-click): select the innermost shape directly, ignoring grouping.
   *  - group isolation (state.activeGroupId, set by double-click): select the
   *    direct child of the entered group along the click path, so children can be
   *    picked and moved individually. Clicks outside the entered group fall back
   *    to top-level resolution.
   */
  private findShapeElement(target: SVGElement, opts: { deep?: boolean } = {}): SVGElement | null {
    const chain = this.shapeChain(target);
    if (chain.length === 0) return null;
    if (opts.deep) return chain[0];

    const activeId = this.state.activeGroupId;
    if (activeId) {
      const activeEl = chain.find(s => s.id === activeId);
      if (activeEl) {
        // One level into the entered group, along the click path.
        return chain.find(s => (s.parentElement as Element | null) === activeEl) ?? activeEl;
      }
      // Target is outside the entered group → unscoped (top-level) resolution.
    }
    return chain[chain.length - 1];
  }

  /** Is `el` a descendant of the currently-entered group? */
  private isInActiveGroup(el: SVGElement | null): boolean {
    const activeId = this.state.activeGroupId;
    if (!activeId || !el) return false;
    const activeEl = document.getElementById(activeId) as Element | null;
    return !!activeEl && activeEl !== el && activeEl.contains(el);
  }

  private getSelectedShapes(): ShapeData[] {
    return this.state.selectedShapeIds
      .map(id => this.state.findShapeById(id))
      .filter((s): s is ShapeData => s !== null);
  }


  // ---- Position helpers ----

  /** Move element by dx,dy (given in #drawing-layer / canvas space). Works for
   *  rotated elements and for children nested inside transformed groups. */
  private translateElement(el: SVGElement, dx: number, dy: number): void {
    const tag = el.tagName.toLowerCase();

    // A child's geometry lives in its PARENT group's coordinate space. If that
    // group is scaled/rotated, the canvas-space delta must be mapped into the
    // group's local space first (a no-op for top-level shapes and identity groups).
    const parent = el.parentElement as unknown as SVGGraphicsElement | null;
    if (parent && (parent as unknown as SVGElement).id?.startsWith('shape-')) {
      const conv = this.toParentDelta(parent, dx, dy);
      dx = conv.dx; dy = conv.dy;
    }

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

  /**
   * Map a delta vector from #drawing-layer (canvas) space into `parentEl`'s local
   * coordinate space, so a child nested under a scaled/rotated group drags 1:1
   * with the cursor. Identity ancestors (the common case) return the delta as-is.
   */
  private toParentDelta(parentEl: SVGGraphicsElement, dx: number, dy: number): { dx: number; dy: number } {
    const drawingLayer = this.svgCanvas.querySelector('#drawing-layer') as unknown as SVGGraphicsElement | null;
    const pCtm = parentEl.getCTM?.();
    const dCtm = drawingLayer?.getCTM?.();
    if (!pCtm || !dCtm) return { dx, dy };
    // m maps parent-local → drawing-layer; we want the reverse for the delta.
    const m = dCtm.inverse().multiply(pCtm);
    // Fast path: identity linear part (top-level shapes & untransformed groups).
    if (m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1) return { dx, dy };
    const inv = m.inverse();
    if (!isFinite(inv.a) || !isFinite(inv.d)) return { dx, dy }; // degenerate
    // Transform as a free vector: only the linear part (ignore translation).
    return { dx: inv.a * dx + inv.c * dy, dy: inv.b * dx + inv.d * dy };
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
