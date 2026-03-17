import { BaseTool } from './base';
import type { Point } from '../core/types';

export class TextTool extends BaseTool {
  name = 'text';

  onMouseDown(pt: Point, _e: MouseEvent): void {
    const content = prompt('Enter text:', 'Text');
    if (!content) return;

    const el = document.createElementNS(this.NS, 'text') as SVGTextElement;
    const id = this.state.nextId();
    el.id = id;
    el.setAttribute('x', String(pt.x));
    el.setAttribute('y', String(pt.y));
    el.setAttribute('font-size', String(this.state.defaultStyle.fontSize ?? 24));
    el.setAttribute('font-family', this.state.defaultStyle.fontFamily ?? 'Arial');
    el.setAttribute('font-weight', this.state.defaultStyle.fontWeight ?? 'normal');
    el.setAttribute('font-style', this.state.defaultStyle.fontStyle ?? 'normal');
    el.setAttribute('fill', this.state.fillNone ? 'none' : this.state.defaultStyle.fill);
    if (!this.state.strokeNone && this.state.defaultStyle.strokeWidth > 0) {
      el.setAttribute('stroke', this.state.defaultStyle.stroke);
      el.setAttribute('stroke-width', String(this.state.defaultStyle.strokeWidth));
    }
    if (this.state.defaultStyle.opacity !== 1) el.setAttribute('opacity', String(this.state.defaultStyle.opacity));
    el.textContent = content;

    const name = `Type ${id.replace('shape-', '')}`;
    el.setAttribute('data-name', name);

    this.state.addShape({
      id, type: 'text', element: el, name,
      style: { ...this.state.defaultStyle, fill: this.state.fillNone ? 'none' : this.state.defaultStyle.fill, stroke: this.state.strokeNone ? 'none' : this.state.defaultStyle.stroke },
      visible: true, locked: false,
    });
  }

  onMouseMove(_pt: Point, _e: MouseEvent): void {}
  onMouseUp(_pt: Point, _e: MouseEvent): void {}
}
