import { BaseTool } from './base';
import type { Point } from '../core/types';

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
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      this.placeImage(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  private placeImage(dataUrl: string): void {
    // Create a temporary HTML image to get dimensions
    const img = new Image();
    img.onload = () => {
      const el = document.createElementNS(this.NS, 'image') as SVGImageElement;
      const id = this.state.nextId();
      el.id = id;
      const name = `image ${id.replace('shape-', '#')}`;
      el.setAttribute('data-name', name);

      // Place at artboard center, preserving aspect ratio
      const ab = this.state.getActiveArtboard();
      let w = img.naturalWidth;
      let h = img.naturalHeight;

      // Scale down if larger than artboard
      const maxW = ab.width * 0.8;
      const maxH = ab.height * 0.8;
      if (w > maxW || h > maxH) {
        const scale = Math.min(maxW / w, maxH / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      const x = ab.x + (ab.width - w) / 2;
      const y = ab.y + (ab.height - h) / 2;

      el.setAttribute('x', String(x));
      el.setAttribute('y', String(y));
      el.setAttribute('width', String(w));
      el.setAttribute('height', String(h));
      el.setAttribute('href', dataUrl);
      el.setAttribute('preserveAspectRatio', 'xMidYMid meet');

      this.state.addShape({
        id,
        type: 'image',
        element: el,
        name,
        style: { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1 },
        visible: true,
        locked: false,
      });
    };
    img.src = dataUrl;
  }
}
