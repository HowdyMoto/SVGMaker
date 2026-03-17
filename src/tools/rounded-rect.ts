import { BaseTool } from './base';
import type { Point } from '../core/types';

export class RoundedRectTool extends BaseTool {
  name = 'roundedRect';
  private drawing = false;
  private startPt: Point = { x: 0, y: 0 };
  private currentEl: SVGRectElement | null = null;

  onMouseDown(pt: Point, _e: MouseEvent): void {
    this.drawing = true;
    this.startPt = { ...pt };

    const el = document.createElementNS(this.NS, 'rect') as SVGRectElement;
    el.setAttribute('x', String(pt.x));
    el.setAttribute('y', String(pt.y));
    el.setAttribute('width', '0');
    el.setAttribute('height', '0');
    el.setAttribute('rx', String(this.state.defaultStyle.rx ?? 10));
    this.applyStyle(el);

    const guidesLayer = this.svgCanvas.querySelector('#guides-layer')!;
    guidesLayer.appendChild(el);
    this.currentEl = el;
  }

  onMouseMove(pt: Point, e: MouseEvent): void {
    if (!this.drawing || !this.currentEl) return;

    let x = Math.min(pt.x, this.startPt.x);
    let y = Math.min(pt.y, this.startPt.y);
    let w = Math.abs(pt.x - this.startPt.x);
    let h = Math.abs(pt.y - this.startPt.y);

    if (e.shiftKey) {
      const size = Math.min(w, h);
      w = size; h = size;
      if (pt.x < this.startPt.x) x = this.startPt.x - size;
      if (pt.y < this.startPt.y) y = this.startPt.y - size;
    }

    this.currentEl.setAttribute('x', String(x));
    this.currentEl.setAttribute('y', String(y));
    this.currentEl.setAttribute('width', String(w));
    this.currentEl.setAttribute('height', String(h));
  }

  onMouseUp(_pt: Point, _e: MouseEvent): void {
    if (!this.drawing || !this.currentEl) return;
    this.drawing = false;
    const w = parseFloat(this.currentEl.getAttribute('width') ?? '0');
    const h = parseFloat(this.currentEl.getAttribute('height') ?? '0');
    this.currentEl.remove();

    if (w < 2 && h < 2) { this.currentEl = null; return; }

    const el = document.createElementNS(this.NS, 'rect') as SVGRectElement;
    const id = this.state.nextId();
    el.id = id;
    el.setAttribute('x', this.currentEl.getAttribute('x')!);
    el.setAttribute('y', this.currentEl.getAttribute('y')!);
    el.setAttribute('width', String(w));
    el.setAttribute('height', String(h));
    el.setAttribute('rx', String(this.state.defaultStyle.rx ?? 10));
    this.applyStyle(el);

    const name = `rounded rect ${id.replace('shape-', '#')}`;
    el.setAttribute('data-name', name);

    this.state.addShape({
      id, type: 'rect', element: el, name,
      style: { ...this.state.defaultStyle, fill: this.state.fillNone ? 'none' : this.state.defaultStyle.fill, stroke: this.state.strokeNone ? 'none' : this.state.defaultStyle.stroke, rx: this.state.defaultStyle.rx ?? 10 },
      visible: true, locked: false,
    });
    this.currentEl = null;
  }
}
