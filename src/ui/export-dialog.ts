import type { AppState } from '../core/state';
import type { ExportFormat, Artboard } from '../core/types';
import { bakeLayerContent } from '../core/bake';
import { SVG_NS_DECLS } from '../core/svg-ns';
import { outlineText, buildEmbeddedFontStyle } from '../core/text-outline';
import { supportsFileSystemAccess, saveFilePicker, writeHandle, downloadFile } from '../core/file-access';
import { openModal } from './modal';
import { createButton, createSelect, createField, createCheckRow, createModalHeader, createModalBody, createModalFooter } from './components';

type TextMode = 'keep' | 'outline' | 'embed';

/** Drawing-layer markup, with element transforms baked into geometry if asked. */
function layerContent(state: AppState, bake: boolean): string {
  if (!bake) return state.getDrawingLayerSVGForExport();
  const dl = document.getElementById('drawing-layer') as unknown as SVGGElement | null;
  return dl ? bakeLayerContent(dl).content : state.getDrawingLayerSVGForExport();
}

/** Export a single artboard straight to an .svg file (used by the panel's per-row button). */
export async function exportArtboardToFile(state: AppState, ab: Artboard): Promise<void> {
  const svgStr = buildArtboardSVG(ab, layerContent(state, state.bakeTransformsOnExport), state.getDefsBlock(), state.getExtraNamespaceDecls());
  const filename = `${sanitizeFilename(ab.name)}.svg`;
  if (supportsFileSystemAccess()) {
    try {
      const handle = await saveFilePicker(filename, [{ description: 'SVG Image', accept: { 'image/svg+xml': ['.svg'] } }]);
      if (handle) await writeHandle(handle, svgStr);
    } catch (err) {
      alert('Export failed: ' + (err instanceof Error ? err.message : String(err)));
    }
    return;
  }
  downloadFile(filename, svgStr, 'image/svg+xml');
}

/**
 * Shows a modal dialog to export all artboards (or a selection) in SVG/PNG/JPG.
 */
export function showExportDialog(state: AppState): void {
  // Overlay, Escape/click-outside dismissal, focus handling and the \u2715 button
  // all come from the shared Modal primitive (ui/modal.ts).
  const modal = openModal({
    id: 'export-dialog-overlay',
    ariaLabel: 'Export Frames',
    dialogClass: 'export-dialog',
  });
  if (!modal) return; // already open
  const { dialog, close } = modal;

  dialog.appendChild(createModalHeader('Export Frames'));

  const body = createModalBody();

  // Format
  const formatSelect = createSelect([
    { value: 'svg', label: 'SVG (.svg)', selected: true },
    { value: 'png', label: 'PNG (.png)' },
    { value: 'jpg', label: 'JPG (.jpg)' },
  ]);
  body.appendChild(createField('Format', formatSelect));

  // Scale (raster only)
  const scaleSelect = createSelect([
    { value: '1', label: '1x' },
    { value: '2', label: '2x', selected: true },
    { value: '3', label: '3x' },
    { value: '4', label: '4x' },
  ]);
  const scaleField = createField('Scale', scaleSelect);
  body.appendChild(scaleField);
  // Scale only applies to raster output — hide it for SVG (incl. the default).
  const syncScaleRow = () => { scaleField.style.display = formatSelect.value === 'svg' ? 'none' : ''; };
  formatSelect.addEventListener('change', syncScaleRow);
  syncScaleRow();

  // Bake transforms toggle
  const { row: bakeRow, input: bakeCb } = createCheckRow(
    'Bake transforms into geometry',
    state.bakeTransformsOnExport,
    { title: 'Flatten rotation/scale/translate into coordinates (for tools that ignore transform attributes).' },
  );
  body.appendChild(bakeRow);

  // Text handling (SVG only — raster formats bake text to pixels anyway)
  const textSelect = createSelect([
    { value: 'keep', label: 'Keep as live text' },
    { value: 'outline', label: 'Convert to outlines (paths)' },
    { value: 'embed', label: 'Embed font data' },
  ]);
  const textField = createField('Text', textSelect);
  body.appendChild(textField);
  const syncTextRow = () => { textField.style.display = formatSelect.value === 'svg' ? '' : 'none'; };
  formatSelect.addEventListener('change', syncTextRow);
  syncTextRow();

  // Artboard selection
  const abField = document.createElement('div');
  abField.className = 'field';
  const abLabel = document.createElement('label');
  abLabel.className = 'field-label';
  abLabel.textContent = 'Frames to export';
  abField.appendChild(abLabel);

  const actions = document.createElement('div');
  actions.className = 'field-actions';
  const selectAllBtn = createButton('Select All', { small: true });
  const selectNoneBtn = createButton('Select None', { small: true });
  actions.append(selectAllBtn, selectNoneBtn);
  abField.appendChild(actions);

  const checkboxes: HTMLInputElement[] = [];
  for (const ab of state.artboards) {
    const { row, input } = createCheckRow(`${ab.name}  (${ab.width}\u00D7${ab.height})`, true, { value: ab.id });
    checkboxes.push(input);
    abField.appendChild(row);
  }

  selectAllBtn.addEventListener('click', () => checkboxes.forEach(cb => cb.checked = true));
  selectNoneBtn.addEventListener('click', () => checkboxes.forEach(cb => cb.checked = false));

  body.appendChild(abField);
  dialog.appendChild(body);

  // Footer
  const footer = createModalFooter();
  const cancelBtn = createButton('Cancel', { onClick: () => close() });
  const exportBtn = createButton('Export', { variant: 'primary' });
  exportBtn.addEventListener('click', async () => {
    const format = formatSelect.value as ExportFormat;
    const scale = parseInt(scaleSelect.value);
    const bake = bakeCb.checked;
    const textMode = textSelect.value as TextMode;
    const selectedIds = checkboxes.filter(cb => cb.checked).map(cb => cb.value);
    if (selectedIds.length === 0) { alert('Select at least one frame.'); return; }

    exportBtn.textContent = 'Exporting...';
    exportBtn.style.opacity = '0.6';

    const selectedAbs = state.artboards.filter(ab => selectedIds.includes(ab.id));
    try {
      await exportArtboards(state, selectedAbs, format, scale, bake, textMode);
    } catch (err) {
      alert('Export failed: ' + (err instanceof Error ? err.message : err));
    }

    close();
  });

  footer.append(cancelBtn, exportBtn);
  dialog.appendChild(footer);
}

async function exportArtboards(
  state: AppState,
  artboards: Artboard[],
  format: ExportFormat,
  scale: number,
  bake: boolean,
  textMode: TextMode = 'keep',
): Promise<void> {
  let drawingSvg = layerContent(state, bake);
  let defsBlock = state.getDefsBlock();

  // Text handling only applies to vector (SVG) output.
  const warnings: string[] = [];
  if (format === 'svg' && textMode === 'outline') {
    const r = await outlineText(drawingSvg);
    drawingSvg = r.content;
    warnings.push(...r.warnings);
  } else if (format === 'svg' && textMode === 'embed') {
    const r = await buildEmbeddedFontStyle(drawingSvg);
    if (r.style) defsBlock = r.style + '\n  ' + defsBlock;
    warnings.push(...r.warnings);
  }

  for (const ab of artboards) {
    const fileName = sanitizeFilename(ab.name);

    if (format === 'svg') {
      const svgStr = buildArtboardSVG(ab, drawingSvg, defsBlock, state.getExtraNamespaceDecls());
      downloadBlob(new Blob([svgStr], { type: 'image/svg+xml' }), `${fileName}.svg`);
    } else {
      const svgStr = buildArtboardSVG(ab, drawingSvg, defsBlock, state.getExtraNamespaceDecls());
      const blob = await rasterize(svgStr, ab.width, ab.height, scale, format);
      downloadBlob(blob, `${fileName}.${format}`);
    }

    // Small delay between downloads so browser doesn't block them
    if (artboards.length > 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  if (warnings.length) {
    alert('Export completed with notes:\n\n' + warnings.join('\n'));
  }
}

function buildArtboardSVG(ab: Artboard, drawingSvg: string, defsBlock: string, extraNs = ''): string {
  // Clip drawing content to the artboard bounds via a viewBox
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" ${SVG_NS_DECLS}${extraNs}
     viewBox="${ab.x} ${ab.y} ${ab.width} ${ab.height}"
     width="${ab.width}" height="${ab.height}">
  ${defsBlock}<rect x="${ab.x}" y="${ab.y}" width="${ab.width}" height="${ab.height}" fill="white"/>
  ${drawingSvg}
</svg>`;
}

function rasterize(
  svgString: string,
  w: number,
  h: number,
  scale: number,
  format: ExportFormat,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale);

      if (format === 'jpg') {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, w, h);
      }

      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);

      const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
      const quality = format === 'jpg' ? 0.92 : undefined;

      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('Canvas toBlob returned null'));
      }, mimeType, quality);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load SVG as image'));
    };

    img.src = url;
  });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
}
