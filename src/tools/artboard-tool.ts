import { BaseTool } from './base';
import type { Point, Artboard } from '../core/types';

export class ArtboardTool extends BaseTool {
  name = 'artboard';
  private mode: 'idle' | 'creating' | 'moving' | 'resizing' = 'idle';
  private startPt: Point = { x: 0, y: 0 };
  private previewEl: SVGRectElement | null = null;
  // Moving
  private movingAb: Artboard | null = null;
  private moveOrigX = 0;
  private moveOrigY = 0;
  // Resizing
  private resizingAb: Artboard | null = null;
  private resizeHandle = '';
  private resizeOrigRect = { x: 0, y: 0, w: 0, h: 0 };

  activate(): void {
    this.svgCanvas.style.cursor = 'crosshair';
    // Highlight artboards with editable borders
    this.state.selectedArtboardId = this.state.activeArtboardId;
    this.state.onChange_public();
  }

  deactivate(): void {
    this.svgCanvas.style.cursor = '';
    this.state.selectedArtboardId = null;
    this.cleanup();
    this.state.onChange_public();
  }

  onMouseDown(pt: Point, e: MouseEvent): void {
    // Check if clicking on an artboard resize handle
    const handle = (e.target as SVGElement).getAttribute?.('data-ab-handle');
    const abId = (e.target as SVGElement).getAttribute?.('data-ab-id');
    if (handle && abId) {
      const ab = this.state.getArtboardById(abId);
      if (ab) {
        this.mode = 'resizing';
        this.resizingAb = ab;
        this.resizeHandle = handle;
        this.resizeOrigRect = { x: ab.x, y: ab.y, w: ab.width, h: ab.height };
        this.startPt = { ...pt };
        return;
      }
    }

    // Check if clicking inside an existing artboard
    const clickedAb = this.findArtboardAt(pt);
    if (clickedAb) {
      this.state.selectedArtboardId = clickedAb.id;
      this.state.setActiveArtboard(clickedAb.id);
      this.mode = 'moving';
      this.movingAb = clickedAb;
      this.moveOrigX = clickedAb.x;
      this.moveOrigY = clickedAb.y;
      this.startPt = { ...pt };
      this.svgCanvas.style.cursor = 'move';
      return;
    }

    // Creating a new artboard
    this.mode = 'creating';
    this.startPt = { ...pt };
    const rect = document.createElementNS(this.NS, 'rect') as SVGRectElement;
    rect.setAttribute('x', String(pt.x));
    rect.setAttribute('y', String(pt.y));
    rect.setAttribute('width', '0');
    rect.setAttribute('height', '0');
    rect.setAttribute('fill', 'rgba(255,255,255,0.5)');
    rect.setAttribute('stroke', '#20a0ff');
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('stroke-dasharray', '5,3');
    const guidesLayer = this.svgCanvas.querySelector('#guides-layer')!;
    guidesLayer.appendChild(rect);
    this.previewEl = rect;
  }

  onMouseMove(pt: Point, _e: MouseEvent): void {
    if (this.mode === 'creating' && this.previewEl) {
      const x = Math.min(pt.x, this.startPt.x);
      const y = Math.min(pt.y, this.startPt.y);
      const w = Math.abs(pt.x - this.startPt.x);
      const h = Math.abs(pt.y - this.startPt.y);
      this.previewEl.setAttribute('x', String(x));
      this.previewEl.setAttribute('y', String(y));
      this.previewEl.setAttribute('width', String(w));
      this.previewEl.setAttribute('height', String(h));
    } else if (this.mode === 'moving' && this.movingAb) {
      const dx = pt.x - this.startPt.x;
      const dy = pt.y - this.startPt.y;
      this.movingAb.x = Math.round(this.moveOrigX + dx);
      this.movingAb.y = Math.round(this.moveOrigY + dy);
      this.state.onChange_public();
    } else if (this.mode === 'resizing' && this.resizingAb) {
      const dx = pt.x - this.startPt.x;
      const dy = pt.y - this.startPt.y;
      const orig = this.resizeOrigRect;
      let x = orig.x, y = orig.y, w = orig.w, h = orig.h;
      if (this.resizeHandle.includes('e')) w += dx;
      if (this.resizeHandle.includes('w')) { x += dx; w -= dx; }
      if (this.resizeHandle.includes('s')) h += dy;
      if (this.resizeHandle.includes('n')) { y += dy; h -= dy; }
      if (w < 20) w = 20;
      if (h < 20) h = 20;
      this.resizingAb.x = Math.round(x);
      this.resizingAb.y = Math.round(y);
      this.resizingAb.width = Math.round(w);
      this.resizingAb.height = Math.round(h);
      this.state.onChange_public();
    }
  }

  onMouseUp(_pt: Point, _e: MouseEvent): void {
    if (this.mode === 'creating' && this.previewEl) {
      const w = parseFloat(this.previewEl.getAttribute('width') ?? '0');
      const h = parseFloat(this.previewEl.getAttribute('height') ?? '0');
      const x = parseFloat(this.previewEl.getAttribute('x') ?? '0');
      const y = parseFloat(this.previewEl.getAttribute('y') ?? '0');
      this.previewEl.remove();
      this.previewEl = null;

      if (w >= 20 && h >= 20) {
        const ab: Artboard = {
          id: this.state.nextArtboardId(),
          x: Math.round(x), y: Math.round(y),
          width: Math.round(w), height: Math.round(h),
          name: `Artboard ${this.state.artboards.length + 1}`,
        };
        this.state.addArtboard(ab);
        this.state.selectedArtboardId = ab.id;
      }
    } else if (this.mode === 'moving' || this.mode === 'resizing') {
      this.state.saveHistory();
      this.svgCanvas.style.cursor = 'crosshair';
    }
    this.mode = 'idle';
    this.movingAb = null;
    this.resizingAb = null;
    this.state.onChange_public();
  }

  onKeyDown(e: KeyboardEvent): void {
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.state.selectedArtboardId) {
      this.state.removeArtboard(this.state.selectedArtboardId);
    }
  }

  private findArtboardAt(pt: Point): Artboard | null {
    // Check in reverse so topmost artboard wins
    for (let i = this.state.artboards.length - 1; i >= 0; i--) {
      const ab = this.state.artboards[i];
      if (pt.x >= ab.x && pt.x <= ab.x + ab.width && pt.y >= ab.y && pt.y <= ab.y + ab.height) {
        return ab;
      }
    }
    return null;
  }

  private cleanup(): void {
    if (this.previewEl) {
      this.previewEl.remove();
      this.previewEl = null;
    }
  }
}
