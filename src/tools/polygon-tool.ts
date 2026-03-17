import { BaseTool } from './base';
import type { Point } from '../core/types';

export class PolygonShapeTool extends BaseTool {
  name = 'polygon';
  private drawing = false;
  private center: Point = { x: 0, y: 0 };
  private previewEl: SVGPolygonElement | null = null;
  private sides = 6;

  onMouseDown(pt: Point, _e: MouseEvent): void {
    this.drawing = true;
    this.center = { ...pt };

    const el = document.createElementNS(this.NS, 'polygon') as SVGPolygonElement;
    this.applyStyle(el);
    const guidesLayer = this.svgCanvas.querySelector('#guides-layer')!;
    guidesLayer.appendChild(el);
    this.previewEl = el;
  }

  onMouseMove(pt: Point, _e: MouseEvent): void {
    if (!this.drawing || !this.previewEl) return;
    const dx = pt.x - this.center.x;
    const dy = pt.y - this.center.y;
    const r = Math.sqrt(dx * dx + dy * dy);
    const startAngle = Math.atan2(dy, dx) - Math.PI / 2;
    const pts = this.calcPolygonPoints(this.center, r, this.sides, startAngle);
    this.previewEl.setAttribute('points', pts);
  }

  onMouseUp(_pt: Point, _e: MouseEvent): void {
    if (!this.drawing || !this.previewEl) return;
    this.drawing = false;
    const ptsStr = this.previewEl.getAttribute('points') ?? '';
    this.previewEl.remove();

    if (!ptsStr || ptsStr.trim().length < 3) {
      this.previewEl = null;
      return;
    }

    const el = document.createElementNS(this.NS, 'polygon') as SVGPolygonElement;
    const id = this.state.nextId();
    el.id = id;
    el.setAttribute('points', ptsStr);
    this.applyStyle(el);
    const name = `polygon ${id.replace('shape-', '#')}`;
    el.setAttribute('data-name', name);

    this.state.addShape({
      id, type: 'polygon', element: el, name,
      style: { ...this.state.defaultStyle, fill: this.state.fillNone ? 'none' : this.state.defaultStyle.fill, stroke: this.state.strokeNone ? 'none' : this.state.defaultStyle.stroke },
      visible: true, locked: false,
    });
    this.previewEl = null;
  }

  private calcPolygonPoints(center: Point, r: number, sides: number, startAngle: number): string {
    const pts: string[] = [];
    for (let i = 0; i < sides; i++) {
      const angle = startAngle + (i * 2 * Math.PI) / sides;
      pts.push(`${center.x + r * Math.cos(angle)},${center.y + r * Math.sin(angle)}`);
    }
    return pts.join(' ');
  }
}
