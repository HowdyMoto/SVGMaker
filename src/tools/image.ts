import { BaseTool } from './base';
import type { Point } from '../core/types';
import { importImageFile } from '../ui/import-image';

export class ImageTool extends BaseTool {
  name = 'image';
  private placing = false;
  private imageEl: SVGImageElement | null = null;
  private startPt: Point = { x: 0, y: 0 };

  activate(): void {
    // Open file picker immediately
    this.pickImage();
  }

  onMouseDown(pt: Point, _e: MouseEvent): void {
    if (!this.placing || !this.imageEl) return;
    this.startPt = { ...pt };
  }

  onMouseMove(pt: Point, _e: MouseEvent): void {
    if (!this.placing || !this.imageEl) return;
    this.imageEl.setAttribute('x', String(Math.min(pt.x, this.startPt.x)));
    this.imageEl.setAttribute('y', String(Math.min(pt.y, this.startPt.y)));
    this.imageEl.setAttribute('width', String(Math.abs(pt.x - this.startPt.x)));
    this.imageEl.setAttribute('height', String(Math.abs(pt.y - this.startPt.y)));
  }

  onMouseUp(_pt: Point, _e: MouseEvent): void {
    if (!this.placing || !this.imageEl) return;
    this.placing = false;
    this.imageEl = null;
  }

  private pickImage(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
    input.style.display = 'none';
    document.body.appendChild(input);

    const cleanup = () => input.remove();
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) this.loadImageFile(file);
      cleanup();
    });
    input.addEventListener('cancel', cleanup);

    input.click();
  }

  loadImageFile(file: File): void {
    importImageFile(this.state, file);
  }
}
