import type { AppState } from '../core/state';

/**
 * Import a raster image (PNG/JPG/GIF/WebP) as an embedded <image> with a
 * base64 data URL, placed centered on the active artboard. Useful as a
 * tracing template — position/scale it, lock it, then draw over it.
 */

const NS = 'http://www.w3.org/2000/svg';

/** Open a file picker and import the chosen raster image. */
export function pickAndImportImage(state: AppState): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/webp';
  input.style.display = 'none';
  document.body.appendChild(input);

  const cleanup = () => input.remove();
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) importImageFile(state, file);
    cleanup();
  });
  input.addEventListener('cancel', cleanup);
  input.click();
}

/** Read a File and embed it as an <image>. */
export function importImageFile(state: AppState, file: File): void {
  const reader = new FileReader();
  reader.onload = () => placeImageDataUrl(state, reader.result as string);
  reader.readAsDataURL(file);
}

/** Embed a data: URL as a centered <image> shape on the active artboard. */
export function placeImageDataUrl(state: AppState, dataUrl: string): void {
  const probe = new Image();
  probe.onload = () => {
    const el = document.createElementNS(NS, 'image') as SVGImageElement;
    const id = state.nextId();
    el.id = id;
    const name = `image ${id.replace('shape-', '#')}`;
    el.setAttribute('data-name', name);

    const ab = state.getActiveArtboard();
    let w = probe.naturalWidth;
    let h = probe.naturalHeight;

    // Scale down to fit the artboard while preserving aspect ratio.
    const maxW = ab.width * 0.9;
    const maxH = ab.height * 0.9;
    if (w > maxW || h > maxH) {
      const scale = Math.min(maxW / w, maxH / h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    el.setAttribute('x', String(ab.x + (ab.width - w) / 2));
    el.setAttribute('y', String(ab.y + (ab.height - h) / 2));
    el.setAttribute('width', String(w));
    el.setAttribute('height', String(h));
    el.setAttribute('href', dataUrl);
    el.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    state.addShape({
      id,
      type: 'image',
      element: el,
      name,
      style: { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1 },
      visible: true,
      locked: false,
    });
  };
  probe.src = dataUrl;
}
