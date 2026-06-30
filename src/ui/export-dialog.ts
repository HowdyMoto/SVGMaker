import type { AppState } from '../core/state';
import type { ExportFormat, Artboard } from '../core/types';
import { bakeLayerContent } from '../core/bake';
import { SVG_NS_DECLS } from '../core/svg-ns';
import { outlineText, buildEmbeddedFontStyle } from '../core/text-outline';
import { supportsFileSystemAccess, saveFilePicker, writeHandle, downloadFile } from '../core/file-access';
import { openModal } from './modal';

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
    ariaLabel: 'Export Artboards',
    dialogClass: 'export-dialog',
  });
  if (!modal) return; // already open
  const { dialog, close } = modal;

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'padding:14px 18px 10px; border-bottom:1px solid #2a2a2a;';
  header.innerHTML = '<span style="font-size:14px; font-weight:600; color:#eee;">Export Artboards</span>';
  dialog.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.style.cssText = 'padding:14px 18px;';

  // Format selector
  const formatRow = document.createElement('div');
  formatRow.style.cssText = 'margin-bottom:14px;';
  formatRow.innerHTML = '<label style="display:block; margin-bottom:4px; color:#aaa; font-size:11px;">Format</label>';
  const formatSelect = document.createElement('select');
  formatSelect.style.cssText = 'width:100%; height:28px; background:#1e1e1e; color:#ccc; border:1px solid #4a4a4a; border-radius:3px; padding:0 8px;';
  formatSelect.innerHTML = `
    <option value="svg" selected>SVG (.svg)</option>
    <option value="png">PNG (.png)</option>
    <option value="jpg">JPG (.jpg)</option>
  `;
  formatRow.appendChild(formatSelect);
  body.appendChild(formatRow);

  // Scale selector (for raster formats)
  const scaleRow = document.createElement('div');
  scaleRow.style.cssText = 'margin-bottom:14px;';
  scaleRow.innerHTML = '<label style="display:block; margin-bottom:4px; color:#aaa; font-size:11px;">Scale</label>';
  const scaleSelect = document.createElement('select');
  scaleSelect.style.cssText = 'width:100%; height:28px; background:#1e1e1e; color:#ccc; border:1px solid #4a4a4a; border-radius:3px; padding:0 8px;';
  scaleSelect.innerHTML = `
    <option value="1">1x</option>
    <option value="2" selected>2x</option>
    <option value="3">3x</option>
    <option value="4">4x</option>
  `;
  scaleRow.appendChild(scaleSelect);
  body.appendChild(scaleRow);

  // Scale only applies to raster output — hide it for SVG (incl. the default).
  const syncScaleRow = () => { scaleRow.style.display = formatSelect.value === 'svg' ? 'none' : ''; };
  formatSelect.addEventListener('change', syncScaleRow);
  syncScaleRow();

  // Bake transforms toggle
  const bakeRow = document.createElement('label');
  bakeRow.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:14px; cursor:pointer;';
  const bakeCb = document.createElement('input');
  bakeCb.type = 'checkbox';
  bakeCb.checked = state.bakeTransformsOnExport;
  bakeCb.style.cssText = 'accent-color:#2196F3;';
  const bakeText = document.createElement('span');
  bakeText.textContent = 'Bake transforms into geometry';
  bakeText.title = 'Flatten rotation/scale/translate into coordinates (for tools that ignore transform attributes).';
  bakeRow.appendChild(bakeCb);
  bakeRow.appendChild(bakeText);
  body.appendChild(bakeRow);

  // Text handling (SVG only — raster formats bake text to pixels anyway)
  const textRow = document.createElement('div');
  textRow.style.cssText = 'margin-bottom:14px;';
  textRow.innerHTML = '<label style="display:block; margin-bottom:4px; color:#aaa; font-size:11px;">Text</label>';
  const textSelect = document.createElement('select');
  textSelect.style.cssText = 'width:100%; height:28px; background:#1e1e1e; color:#ccc; border:1px solid #4a4a4a; border-radius:3px; padding:0 8px;';
  textSelect.innerHTML = `
    <option value="keep">Keep as live text</option>
    <option value="outline">Convert to outlines (paths)</option>
    <option value="embed">Embed font data</option>
  `;
  textRow.appendChild(textSelect);
  body.appendChild(textRow);
  // Only meaningful for SVG output.
  const syncTextRow = () => { textRow.style.display = formatSelect.value === 'svg' ? '' : 'none'; };
  formatSelect.addEventListener('change', syncTextRow);
  syncTextRow();

  // Artboard selection
  const abRow = document.createElement('div');
  abRow.style.cssText = 'margin-bottom:14px;';
  abRow.innerHTML = '<label style="display:block; margin-bottom:6px; color:#aaa; font-size:11px;">Artboards to export</label>';

  const selectAllRow = document.createElement('div');
  selectAllRow.style.cssText = 'margin-bottom:6px; display:flex; gap:8px;';
  const selectAllBtn = document.createElement('button');
  selectAllBtn.textContent = 'Select All';
  selectAllBtn.style.cssText = 'background:#4a4a4a; border:1px solid #555; border-radius:3px; color:#ccc; padding:3px 10px; cursor:pointer; font-size:11px;';
  const selectNoneBtn = document.createElement('button');
  selectNoneBtn.textContent = 'Select None';
  selectNoneBtn.style.cssText = 'background:#4a4a4a; border:1px solid #555; border-radius:3px; color:#ccc; padding:3px 10px; cursor:pointer; font-size:11px;';
  selectAllRow.appendChild(selectAllBtn);
  selectAllRow.appendChild(selectNoneBtn);
  abRow.appendChild(selectAllRow);

  const checkboxes: HTMLInputElement[] = [];
  for (const ab of state.artboards) {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:4px 8px; cursor:pointer; border-radius:3px;';
    row.addEventListener('mouseenter', () => { row.style.background = '#4a4a4a'; });
    row.addEventListener('mouseleave', () => { row.style.background = ''; });

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.value = ab.id;
    cb.style.cssText = 'accent-color:#2196F3;';
    checkboxes.push(cb);

    const text = document.createElement('span');
    text.textContent = `${ab.name}  (${ab.width}\u00D7${ab.height})`;

    row.appendChild(cb);
    row.appendChild(text);
    abRow.appendChild(row);
  }

  selectAllBtn.addEventListener('click', () => checkboxes.forEach(cb => cb.checked = true));
  selectNoneBtn.addEventListener('click', () => checkboxes.forEach(cb => cb.checked = false));

  body.appendChild(abRow);
  dialog.appendChild(body);

  // Footer
  const footer = document.createElement('div');
  footer.style.cssText = 'padding:10px 18px 14px; border-top:1px solid #2a2a2a; display:flex; justify-content:flex-end; gap:8px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'background:#4a4a4a; border:1px solid #555; border-radius:3px; color:#ccc; padding:6px 16px; cursor:pointer;';
  cancelBtn.addEventListener('click', () => close());

  const exportBtn = document.createElement('button');
  exportBtn.textContent = 'Export';
  exportBtn.style.cssText = 'background:#2196F3; border:1px solid #1976D2; border-radius:3px; color:white; padding:6px 20px; cursor:pointer; font-weight:600;';
  exportBtn.addEventListener('click', async () => {
    const format = formatSelect.value as ExportFormat;
    const scale = parseInt(scaleSelect.value);
    const bake = bakeCb.checked;
    const textMode = textSelect.value as TextMode;
    const selectedIds = checkboxes.filter(cb => cb.checked).map(cb => cb.value);
    if (selectedIds.length === 0) { alert('Select at least one artboard.'); return; }

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

  footer.appendChild(cancelBtn);
  footer.appendChild(exportBtn);
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
