import type { AppState } from '../core/state';
import type { CanvasController } from '../core/canvas';
import type { Point, ShapeData } from '../core/types';
import { applyStrokeAlignment } from '../core/stroke-align';

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
    if ((s.fillOpacity ?? 1) !== 1) {
      el.setAttribute('fill-opacity', String(s.fillOpacity));
    }
    if ((s.strokeOpacity ?? 1) !== 1) {
      el.setAttribute('stroke-opacity', String(s.strokeOpacity));
    }
    if (s.strokeDashoffset) el.setAttribute('stroke-dashoffset', String(s.strokeDashoffset));
    if ((s.strokeMiterlimit ?? 4) !== 4) el.setAttribute('stroke-miterlimit', String(s.strokeMiterlimit));
    if (s.strokeNonScaling) el.setAttribute('vector-effect', 'non-scaling-stroke');
    if (s.strokeAlign && s.strokeAlign !== 'center') {
      applyStrokeAlignment(el, el.tagName.toLowerCase() as ShapeData['type'], s.strokeAlign, s.strokeWidth);
    }
  }
}
