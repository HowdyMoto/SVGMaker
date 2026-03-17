import { BaseTool } from './base';
import type { Point } from '../core/types';

export class PolylineTool extends BaseTool {
  name = 'polyline';
  private points: Point[] = [];
  private previewEl: SVGPolylineElement | null = null;
  private guidesLayer: Element | null = null;
  private dotEls: SVGCircleElement[] = [];

  activate(): void {
    this.points = [];
    this.cleanup();
  }

  deactivate(): void {
    this.finishShape();
  }

  onMouseDown(pt: Point, e: MouseEvent): void {
    if (e.detail === 2) { this.finishShape(); return; }

    this.points.push({ ...pt });
    this.updatePreview(pt);

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

  onMouseMove(pt: Point, _e: MouseEvent): void {
    if (this.points.length > 0) this.updatePreview(pt);
  }

  onMouseUp(_pt: Point, _e: MouseEvent): void {}

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === 'Escape') this.finishShape();
  }

  private updatePreview(currentPt: Point): void {
    if (!this.guidesLayer) this.guidesLayer = this.svgCanvas.querySelector('#guides-layer')!;
    if (!this.previewEl) {
      this.previewEl = document.createElementNS(this.NS, 'polyline') as SVGPolylineElement;
      this.previewEl.setAttribute('fill', 'none');
      this.previewEl.setAttribute('stroke', '#20a0ff');
      this.previewEl.setAttribute('stroke-width', '1.5');
      this.previewEl.setAttribute('stroke-dasharray', '5,5');
      this.guidesLayer.appendChild(this.previewEl);
    }
    const allPts = [...this.points, currentPt];
    this.previewEl.setAttribute('points', allPts.map(p => `${p.x},${p.y}`).join(' '));
  }

  private finishShape(): void {
    this.cleanup();
    if (this.points.length < 2) { this.points = []; return; }

    const el = document.createElementNS(this.NS, 'polyline') as SVGPolylineElement;
    const id = this.state.nextId();
    el.id = id;
    el.setAttribute('points', this.points.map(p => `${p.x},${p.y}`).join(' '));
    this.applyStyle(el);

    const name = `Polyline ${id.replace('shape-', '')}`;
    el.setAttribute('data-name', name);

    this.state.addShape({
      id, type: 'polyline', element: el, name,
      style: { ...this.state.defaultStyle, fill: this.state.fillNone ? 'none' : this.state.defaultStyle.fill, stroke: this.state.strokeNone ? 'none' : this.state.defaultStyle.stroke },
      visible: true, locked: false,
    });
    this.points = [];
  }

  private cleanup(): void {
    if (this.previewEl) { this.previewEl.remove(); this.previewEl = null; }
    for (const dot of this.dotEls) dot.remove();
    this.dotEls = [];
  }
}
