import type { AppState } from '../core/state';
import { saveFilePicker, writeHandle, downloadFile, readSvgFile } from '../core/file-access';
import { SVG_NS_DECLS } from '../core/svg-ns';
import { bakeLayerContent } from '../core/bake';
import { withLoadingOverlay } from './loading-overlay';
import { showToast } from './toast';

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
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const text = await readSvgFile(file);
    if (text.length < 1_000_000) {
      state.importSVGContent(text);
    } else {
      await withLoadingOverlay(`Importing ${file.name}…`, () => state.importSVGContent(text));
    }
    if (state.lastImportHadAnimation) {
      showToast('This SVG used SMIL animation, which BuzzQuill doesn’t support yet. The static image was imported — saving won’t include the animation.');
    }
  };
}

