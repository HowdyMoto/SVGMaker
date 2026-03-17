import type { AppState } from '../core/state';
import type { CanvasController } from '../core/canvas';
import type { Point } from '../core/types';

export interface Tool {
  name: string;
  onMouseDown(pt: Point, e: MouseEvent): void;
  onMouseMove(pt: Point, e: MouseEvent): void;
  onMouseUp(pt: Point, e: MouseEvent): void;
  onKeyDown?(e: KeyboardEvent): void;
  activate?(): void;
  deactivate?(): void;
}

export abstract class BaseTool implements Tool {
  abstract name: string;
  protected state: AppState;
  protected canvas: CanvasController;
  protected svgCanvas: SVGSVGElement;
  protected NS = 'http://www.w3.org/2000/svg';

  constructor(state: AppState, canvas: CanvasController, svgCanvas: SVGSVGElement) {
    this.state = state;
    this.canvas = canvas;
    this.svgCanvas = svgCanvas;
  }

  abstract onMouseDown(pt: Point, e: MouseEvent): void;
  abstract onMouseMove(pt: Point, e: MouseEvent): void;
  abstract onMouseUp(pt: Point, e: MouseEvent): void;

  protected applyStyle(el: SVGElement): void {
    const s = this.state.defaultStyle;
    el.setAttribute('fill', this.state.fillNone ? 'none' : s.fill);
    el.setAttribute('stroke', this.state.strokeNone ? 'none' : s.stroke);
    el.setAttribute('stroke-width', String(s.strokeWidth));
    if (s.opacity !== 1) {
      el.setAttribute('opacity', String(s.opacity));
    }
  }
}
