import { BaseTool } from './base';
import type { Point } from '../core/types';

export class EyedropperTool extends BaseTool {
  name = 'eyedropper';

  activate(): void {
    this.svgCanvas.style.cursor = 'crosshair';
  }

  deactivate(): void {
    this.svgCanvas.style.cursor = '';
  }

  onMouseDown(_pt: Point, e: MouseEvent): void {
    const target = e.target as SVGElement;
    const shapeEl = this.findShapeElement(target);
    if (!shapeEl) return;

    const fill = shapeEl.getAttribute('fill') ?? '';
    const stroke = shapeEl.getAttribute('stroke') ?? '';
    const strokeWidth = shapeEl.getAttribute('stroke-width') ?? '';

    if (fill && fill !== 'none') {
      this.state.defaultStyle.fill = fill;
      this.state.fillNone = false;
    } else if (fill === 'none') {
      this.state.fillNone = true;
    }

    if (stroke && stroke !== 'none') {
      this.state.defaultStyle.stroke = stroke;
      this.state.strokeNone = false;
    } else if (stroke === 'none') {
      this.state.strokeNone = true;
    }

    if (strokeWidth) {
      this.state.defaultStyle.strokeWidth = parseFloat(strokeWidth);
    }

    this.state.onChange_public();
  }

  onMouseMove(_pt: Point, _e: MouseEvent): void {}
  onMouseUp(_pt: Point, _e: MouseEvent): void {}

  private findShapeElement(target: SVGElement): SVGElement | null {
    let el: SVGElement | null = target;
    while (el) {
      if (el.id && el.id.startsWith('shape-')) return el;
      el = el.parentElement as SVGElement | null;
    }
    return null;
  }
}
