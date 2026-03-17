import type { Point } from './types';

export class CanvasController {
  private svgCanvas: SVGSVGElement;
  private viewBox = { x: -80, y: -30, w: 1120, h: 600 };
  private zoom = 1;
  private isPanning = false;
  private panStart: Point = { x: 0, y: 0 };
  private panViewBoxStart = { x: 0, y: 0 };
  private cursorPosEl: HTMLElement;
  private zoomSelect: HTMLSelectElement;
  private onViewChange: (() => void) | null = null;

  constructor(svgCanvas: SVGSVGElement) {
    this.svgCanvas = svgCanvas;
    this.cursorPosEl = document.getElementById('cursor-pos')!;
    this.zoomSelect = document.getElementById('zoom-select') as HTMLSelectElement;
    this.updateViewBox();
    this.setupEvents();
  }

  setOnViewChange(fn: () => void): void {
    this.onViewChange = fn;
  }

  private setupEvents(): void {
    this.svgCanvas.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      this.setZoom(this.zoom * delta, { x: e.clientX, y: e.clientY });
    }, { passive: false });

    this.zoomSelect.addEventListener('change', () => {
      this.setZoom(parseFloat(this.zoomSelect.value));
    });

    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
      this.setZoom(this.zoom * 1.25);
    });

    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
      this.setZoom(this.zoom / 1.25);
    });

    this.svgCanvas.addEventListener('mousemove', (e: MouseEvent) => {
      const pt = this.screenToSVG(e.clientX, e.clientY);
      this.cursorPosEl.textContent = `${Math.round(pt.x)}, ${Math.round(pt.y)}`;

      if (this.isPanning) {
        const dx = (e.clientX - this.panStart.x) / this.zoom;
        const dy = (e.clientY - this.panStart.y) / this.zoom;
        this.viewBox.x = this.panViewBoxStart.x - dx;
        this.viewBox.y = this.panViewBoxStart.y - dy;
        this.updateViewBox();
        this.notifyViewChange();
      }
    });
  }

  startPan(clientX: number, clientY: number): void {
    this.isPanning = true;
    this.panStart = { x: clientX, y: clientY };
    this.panViewBoxStart = { x: this.viewBox.x, y: this.viewBox.y };
    this.svgCanvas.style.cursor = 'grabbing';
  }

  endPan(): void {
    this.isPanning = false;
    this.svgCanvas.style.cursor = '';
  }

  get panning(): boolean {
    return this.isPanning;
  }

  setZoom(newZoom: number, screenCenter?: Point): void {
    newZoom = Math.max(0.05, Math.min(64, newZoom));

    if (screenCenter) {
      const svgPt = this.screenToSVG(screenCenter.x, screenCenter.y);
      this.zoom = newZoom;
      const rect = this.svgCanvas.getBoundingClientRect();
      this.viewBox.w = rect.width / this.zoom;
      this.viewBox.h = rect.height / this.zoom;
      const newSvgPt = this.screenToSVG(screenCenter.x, screenCenter.y);
      this.viewBox.x += svgPt.x - newSvgPt.x;
      this.viewBox.y += svgPt.y - newSvgPt.y;
    } else {
      const cx = this.viewBox.x + this.viewBox.w / 2;
      const cy = this.viewBox.y + this.viewBox.h / 2;
      this.zoom = newZoom;
      const rect = this.svgCanvas.getBoundingClientRect();
      this.viewBox.w = rect.width / this.zoom;
      this.viewBox.h = rect.height / this.zoom;
      this.viewBox.x = cx - this.viewBox.w / 2;
      this.viewBox.y = cy - this.viewBox.h / 2;
    }

    this.updateViewBox();
    this.updateZoomSelect();
    this.notifyViewChange();
  }

  fitToWindow(bounds?: { x: number; y: number; w: number; h: number }): void {
    const rect = this.svgCanvas.getBoundingClientRect();
    const bx = bounds?.x ?? 0;
    const by = bounds?.y ?? 0;
    const bw = bounds?.w ?? 960;
    const bh = bounds?.h ?? 540;
    const pad = 60;
    const scaleX = rect.width / (bw + pad * 2);
    const scaleY = rect.height / (bh + pad * 2);
    const scale = Math.min(scaleX, scaleY);
    this.zoom = scale;
    this.viewBox.w = rect.width / this.zoom;
    this.viewBox.h = rect.height / this.zoom;
    this.viewBox.x = bx + (bw - this.viewBox.w) / 2;
    this.viewBox.y = by + (bh - this.viewBox.h) / 2;
    this.updateViewBox();
    this.updateZoomSelect();
    this.notifyViewChange();
  }

  private updateViewBox(): void {
    this.svgCanvas.setAttribute('viewBox',
      `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.w} ${this.viewBox.h}`);
  }

  private updateZoomSelect(): void {
    const pct = Math.round(this.zoom * 100);
    const options = this.zoomSelect.options;
    let matched = false;
    for (let i = 0; i < options.length; i++) {
      const optPct = Math.round(parseFloat(options[i].value) * 100);
      if (Math.abs(optPct - pct) < 2) {
        this.zoomSelect.selectedIndex = i;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const existing = this.zoomSelect.querySelector('option[data-custom]');
      if (existing) existing.remove();
      const opt = document.createElement('option');
      opt.value = String(this.zoom);
      opt.textContent = `${pct}%`;
      opt.setAttribute('data-custom', 'true');
      opt.selected = true;
      this.zoomSelect.appendChild(opt);
    }
  }

  private notifyViewChange(): void {
    if (this.onViewChange) this.onViewChange();
  }

  screenToSVG(clientX: number, clientY: number): Point {
    const rect = this.svgCanvas.getBoundingClientRect();
    return {
      x: this.viewBox.x + (clientX - rect.left) / this.zoom,
      y: this.viewBox.y + (clientY - rect.top) / this.zoom,
    };
  }

  getZoom(): number {
    return this.zoom;
  }

  getViewBox(): { x: number; y: number; w: number; h: number } {
    return { ...this.viewBox };
  }

  initSize(centerOn?: { x: number; y: number; w: number; h: number }): void {
    const rect = this.svgCanvas.getBoundingClientRect();
    this.viewBox.w = rect.width / this.zoom;
    this.viewBox.h = rect.height / this.zoom;
    const cx = centerOn?.x ?? 0;
    const cy = centerOn?.y ?? 0;
    const cw = centerOn?.w ?? 960;
    const ch = centerOn?.h ?? 540;
    this.viewBox.x = cx + (cw - this.viewBox.w) / 2;
    this.viewBox.y = cy + (ch - this.viewBox.h) / 2;
    this.updateViewBox();
    this.notifyViewChange();
  }
}
