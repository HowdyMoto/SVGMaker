import type { AppState } from '../core/state';
import { saveFilePicker, writeHandle, downloadFile } from '../core/file-access';
import { SVG_NS_DECLS } from '../core/svg-ns';
import { bakeLayerContent } from '../core/bake';
import { withLoadingOverlay } from './loading-overlay';

const SVG_PICKER_TYPES = [
  { description: 'SVG Image', accept: { 'image/svg+xml': ['.svg'] } },
];

export async function exportSVG(state: AppState): Promise<void> {
  let content = state.getDrawingLayerSVGForExport();
  if (state.bakeTransformsOnExport) {
    const drawingLayer = document.getElementById('drawing-layer') as unknown as SVGGElement | null;
    if (drawingLayer) {
      const baked = bakeLayerContent(drawingLayer);
      content = baked.content;
      if (baked.warnings.length) {
        alert('Exported with transforms baked into geometry.\n\nThese could not be baked and kept a transform:\n• '
          + baked.warnings.join('\n• '));
      }
    }
  }
  const ab = state.artboard;
  const svgString = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" ${SVG_NS_DECLS}${state.getExtraNamespaceDecls()} viewBox="0 0 ${ab.width} ${ab.height}" width="${ab.width}" height="${ab.height}">
${state.getDefsBlock()}${content}
</svg>`;

  const filename = `${ab.name || 'drawing'}.svg`;

  // Prefer a real Save dialog (Chrome/Edge); fall back to a download.
  try {
    const handle = await saveFilePicker(filename, SVG_PICKER_TYPES);
    if (handle) {
      await writeHandle(handle, svgString);
      return;
    }
    // handle === null means either unsupported or the user cancelled.
    if ('showSaveFilePicker' in window) return; // supported but cancelled
  } catch (err) {
    alert('Failed to export SVG: ' + (err instanceof Error ? err.message : String(err)));
    return;
  }

  downloadFile(filename, svgString, 'image/svg+xml');
}

export function importSVG(state: AppState): void {
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  fileInput.click();
  fileInput.onchange = () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const text = reader.result as string;
      if (text.length < 1_000_000) {
        state.importSVGContent(text);
      } else {
        await withLoadingOverlay(`Importing ${file.name}…`, () => state.importSVGContent(text));
      }
    };
    reader.readAsText(file);
    fileInput.value = '';
  };
}

export function exportPNG(state: AppState): void {
  const content = state.getDrawingLayerSVGForExport();
  const ab = state.artboard;
  const svgString = `<svg xmlns="http://www.w3.org/2000/svg" ${SVG_NS_DECLS}${state.getExtraNamespaceDecls()} viewBox="0 0 ${ab.width} ${ab.height}" width="${ab.width}" height="${ab.height}">${state.getDefsBlock()}<rect width="${ab.width}" height="${ab.height}" fill="white"/>${content}</svg>`;

  const img = new Image();
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = ab.width * 2;
    canvas.height = ab.height * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    canvas.toBlob((pngBlob) => {
      if (!pngBlob) return;
      const pngUrl = URL.createObjectURL(pngBlob);
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = 'drawing.png';
      a.click();
      URL.revokeObjectURL(pngUrl);
    }, 'image/png');
  };

  img.src = url;
}
