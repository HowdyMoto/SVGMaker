import { BaseTool } from './base';
import type { Point } from '../core/types';

export class StarTool extends BaseTool {
  name = 'star';
  private drawing = false;
  private center: Point = { x: 0, y: 0 };
  private previewEl: SVGPolygonElement | null = null;
  private points = 5;
  private innerRadius = 0.4;

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
    const outerR = Math.sqrt(dx * dx + dy * dy);
    const innerR = outerR * this.innerRadius;
    const startAngle = Math.atan2(dy, dx) - Math.PI / 2;
    const pts = this.calcStarPoints(this.center, outerR, innerR, this.points, startAngle);
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
    const name = `star ${id.replace('shape-', '#')}`;
    el.setAttribute('data-name', name);

    this.state.addShape({
      id, type: 'polygon', element: el, name,
      style: { ...this.state.defaultStyle, fill: this.state.fillNone ? 'none' : this.state.defaultStyle.fill, stroke: this.state.strokeNone ? 'none' : this.state.defaultStyle.stroke },
      visible: true, locked: false,
    });
    this.previewEl = null;
  }

  private calcStarPoints(center: Point, outerR: number, innerR: number, points: number, startAngle: number): string {
    const total = points * 2;
    const pts: string[] = [];
    for (let i = 0; i < total; i++) {
      const angle = startAngle + (i * Math.PI) / points;
      const r = i % 2 === 0 ? outerR : innerR;
      pts.push(`${center.x + r * Math.cos(angle)},${center.y + r * Math.sin(angle)}`);
    }
    return pts.join(' ');
  }
}
