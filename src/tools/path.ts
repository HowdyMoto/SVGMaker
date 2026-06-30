import { BaseTool } from './base';
import type { Point } from '../core/types';
import { PathEditSession } from '../core/path-edit';
import { showGestureHud, hideGestureHud } from '../ui/gesture-hud';

interface PathNode {
  point: Point;
  controlIn?: Point;
  controlOut?: Point;
}

export class PathTool extends BaseTool {
  name = 'path';
  private nodes: PathNode[] = [];
  private previewEl: SVGPathElement | null = null;
  private guidesLayer: Element | null = null;
  private dotEls: SVGElement[] = [];
  private isDragging = false;
  private currentNode: PathNode | null = null;
  private closed = false;

  activate(): void { this.nodes = []; this.closed = false; this.cleanup(); }
  deactivate(): void { this.finishPath(); }

  onMouseDown(pt: Point, e: MouseEvent): void {
    if (e.detail === 2) { this.finishPath(); return; }

    if (this.nodes.length === 0) {
      // Not mid-draw: clicking on the selected path's anchor deletes it and on
      // a segment inserts a point (Illustrator's Pen +/- behavior).
      if (this.tryEditSelectedPath(pt)) return;
    } else {
      // Mid-draw: clicking near the first node closes the loop.
      const first = this.nodes[0].point;
      if (Math.hypot(pt.x - first.x, pt.y - first.y) <= this.tolerance()) {
        this.closed = true;
        this.finishPath();
        return;
      }
    }

    this.isDragging = true;
    const node: PathNode = { point: { ...pt } };
    this.currentNode = node;
    this.nodes.push(node);
    showGestureHud('pen', e);

    if (!this.guidesLayer) this.guidesLayer = this.svgCanvas.querySelector('#guides-layer')!;
    const dot = document.createElementNS(this.NS, 'circle') as SVGCircleElement;
    dot.setAttribute('cx', String(pt.x));
    dot.setAttribute('cy', String(pt.y));
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', '#20a0ff');
    dot.setAttribute('stroke', 'white');
    dot.setAttribute('stroke-width', '1');
    this.guidesLayer.appendChild(dot);
    this.dotEls.push(dot);
  }

  onMouseMove(pt: Point, e: MouseEvent): void {
    if (this.isDragging && this.currentNode) {
      const dx = pt.x - this.currentNode.point.x;
      const dy = pt.y - this.currentNode.point.y;
      this.currentNode.controlOut = { x: this.currentNode.point.x + dx, y: this.currentNode.point.y + dy };
      this.currentNode.controlIn = { x: this.currentNode.point.x - dx, y: this.currentNode.point.y - dy };
    }
    if (this.nodes.length > 0) { showGestureHud('pen', e); this.updatePreview(pt); }
  }

  onMouseUp(_pt: Point, _e: MouseEvent): void {
    this.isDragging = false;
    this.currentNode = null;
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter') this.finishPath();
    else if (e.key === 'Escape') this.cancelPath();
  }

  /** Abandon the in-progress path without committing a shape. */
  private cancelPath(): void {
    this.cleanup();
    this.nodes = [];
    this.closed = false;
  }

  private buildPathD(nodes: PathNode[], trailingPt?: Point): string {
    if (nodes.length === 0) return '';
    let d = `M ${nodes[0].point.x} ${nodes[0].point.y}`;
    for (let i = 1; i < nodes.length; i++) {
      const prev = nodes[i - 1];
      const curr = nodes[i];
      if (prev.controlOut || curr.controlIn) {
        const cp1 = prev.controlOut ?? prev.point;
        const cp2 = curr.controlIn ?? curr.point;
        d += ` C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${curr.point.x} ${curr.point.y}`;
      } else {
        d += ` L ${curr.point.x} ${curr.point.y}`;
      }
    }
    if (trailingPt && nodes.length > 0) {
      const last = nodes[nodes.length - 1];
      if (last.controlOut) {
        d += ` C ${last.controlOut.x} ${last.controlOut.y}, ${trailingPt.x} ${trailingPt.y}, ${trailingPt.x} ${trailingPt.y}`;
      } else {
        d += ` L ${trailingPt.x} ${trailingPt.y}`;
      }
    }
    return d;
  }

  private updatePreview(currentPt: Point): void {
    if (!this.guidesLayer) this.guidesLayer = this.svgCanvas.querySelector('#guides-layer')!;
    if (!this.previewEl) {
      this.previewEl = document.createElementNS(this.NS, 'path') as SVGPathElement;
      this.previewEl.setAttribute('fill', 'none');
      this.previewEl.setAttribute('stroke', '#20a0ff');
      this.previewEl.setAttribute('stroke-width', '1.5');
      this.previewEl.setAttribute('stroke-dasharray', '5,5');
      this.guidesLayer.appendChild(this.previewEl);
    }
    this.previewEl.setAttribute('d', this.buildPathD(this.nodes, this.isDragging ? undefined : currentPt));
  }

  private finishPath(): void {
    this.cleanup();
    if (this.nodes.length < 2) { this.nodes = []; this.closed = false; return; }

    const el = document.createElementNS(this.NS, 'path') as SVGPathElement;
    const id = this.state.nextId();
    el.id = id;
    el.setAttribute('d', this.buildPathD(this.nodes) + (this.closed ? ' Z' : ''));
    el.setAttribute('fill', this.state.fillNone ? 'none' : this.state.defaultStyle.fill);
    el.setAttribute('stroke', this.state.strokeNone ? 'none' : this.state.defaultStyle.stroke);
    el.setAttribute('stroke-width', String(this.state.defaultStyle.strokeWidth));
    if (this.state.defaultStyle.opacity !== 1) el.setAttribute('opacity', String(this.state.defaultStyle.opacity));

    const name = `Path ${id.replace('shape-', '')}`;
    el.setAttribute('data-name', name);

    this.state.addShape({
      id, type: 'path', element: el, name,
      style: { ...this.state.defaultStyle, fill: this.state.fillNone ? 'none' : this.state.defaultStyle.fill, stroke: this.state.strokeNone ? 'none' : this.state.defaultStyle.stroke },
      visible: true, locked: false,
    });
    this.nodes = [];
    this.closed = false;
  }

  private cleanup(): void {
    if (this.previewEl) { this.previewEl.remove(); this.previewEl = null; }
    for (const dot of this.dotEls) dot.remove();
    this.dotEls = [];
    hideGestureHud();
  }

  /** Pixel hit tolerance in svg-user units. */
  private tolerance(): number {
    return 8 / this.canvas.getZoom();
  }

  /**
   * Convert an svg-user point (viewBox coords) to an element's local space.
   * Mapping relative to the drawing layer cancels the viewBox offset baked into
   * getCTM().
   */
  private toLocal(pt: Point, el: SVGElement): Point {
    const drawing = this.svgCanvas.querySelector('#drawing-layer') as unknown as SVGGraphicsElement | null;
    const elCtm = (el as unknown as SVGGraphicsElement).getCTM?.();
    const parentCtm = drawing?.getCTM?.();
    if (!elCtm || !parentCtm) return pt;
    const m = parentCtm.inverse().multiply(elCtm);
    const p = this.svgCanvas.createSVGPoint();
    p.x = pt.x; p.y = pt.y;
    const local = p.matrixTransform(m.inverse());
    return { x: local.x, y: local.y };
  }

  /**
   * If a path is selected and the click lands on one of its anchors or segments,
   * delete/insert a node respectively. Returns true if it handled the click.
   */
  private tryEditSelectedPath(pt: Point): boolean {
    const sel = this.state.getSelectedShape();
    if (!sel || sel.type !== 'path' || sel.locked) return false;
    const d = sel.element.getAttribute('d');
    if (!d) return false;

    const session = new PathEditSession(d);
    const local = this.toLocal(pt, sel.element);
    const tol = this.tolerance();

    const a = session.hitAnchor(local.x, local.y, tol);
    if (a) {
      session.selectOnly(a.sp, a.i);
      if (!session.deleteSelected()) return false;
      this.commitTo(sel.element, session);
      return true;
    }

    const seg = session.hitSegment(local.x, local.y, tol);
    if (seg) {
      session.insertAt(seg);
      this.commitTo(sel.element, session);
      return true;
    }

    return false;
  }

  private commitTo(el: SVGElement, session: PathEditSession): void {
    if (session.isEmpty) {
      this.state.removeShape(el.id);
      return;
    }
    el.setAttribute('d', session.commit());
    this.state.saveHistory();
    this.state.onChange_public();
  }
}
