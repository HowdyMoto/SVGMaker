import type { AppState } from '../core/state';
import type { ExportFormat, Artboard } from '../core/types';

/**
 * Shows a modal dialog to export all artboards (or a selection) in SVG/PNG/JPG.
 */
export function showExportDialog(state: AppState): void {
  // Remove existing dialog if any
  document.getElementById('export-dialog-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'export-dialog-overlay';
  overlay.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:9999;
    display:flex; align-items:center; justify-content:center;
    font-family:'Segoe UI',sans-serif; font-size:12px; color:#ccc;
  `;

  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background:#3c3c3c; border:1px solid #555; border-radius:6px;
    width:420px; max-height:80vh; overflow:auto; box-shadow:0 8px 32px rgba(0,0,0,0.5);
  `;

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'padding:14px 18px 10px; border-bottom:1px solid #2a2a2a; display:flex; justify-content:space-between; align-items:center;';
  header.innerHTML = '<span style="font-size:14px; font-weight:600; color:#eee;">Export Artboards</span>';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '\u2715';
  closeBtn.style.cssText = 'background:none; border:none; color:#999; font-size:16px; cursor:pointer; padding:0 4px;';
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);
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
    <option value="svg">SVG (.svg)</option>
    <option value="png" selected>PNG (.png) - 2x resolution</option>
    <option value="jpg">JPG (.jpg) - 2x resolution</option>
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

  // Toggle scale visibility
  formatSelect.addEventListener('change', () => {
    scaleRow.style.display = formatSelect.value === 'svg' ? 'none' : '';
  });

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
  cancelBtn.addEventListener('click', () => overlay.remove());

  const exportBtn = document.createElement('button');
  exportBtn.textContent = 'Export';
  exportBtn.style.cssText = 'background:#2196F3; border:1px solid #1976D2; border-radius:3px; color:white; padding:6px 20px; cursor:pointer; font-weight:600;';
  exportBtn.addEventListener('click', async () => {
    const format = formatSelect.value as ExportFormat;
    const scale = parseInt(scaleSelect.value);
    const selectedIds = checkboxes.filter(cb => cb.checked).map(cb => cb.value);
    if (selectedIds.length === 0) { alert('Select at least one artboard.'); return; }

    exportBtn.textContent = 'Exporting...';
    exportBtn.style.opacity = '0.6';

    const selectedAbs = state.artboards.filter(ab => selectedIds.includes(ab.id));
    try {
      await exportArtboards(state, selectedAbs, format, scale);
    } catch (err) {
      alert('Export failed: ' + (err instanceof Error ? err.message : err));
    }

    overlay.remove();
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(exportBtn);
  dialog.appendChild(footer);

  overlay.appendChild(dialog);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

async function exportArtboards(
  state: AppState,
  artboards: Artboard[],
  format: ExportFormat,
  scale: number,
): Promise<void> {
  const drawingSvg = state.getDrawingLayerSVG();
  const defsBlock = state.getDefsBlock();

  for (const ab of artboards) {
    const fileName = sanitizeFilename(ab.name);

    if (format === 'svg') {
      const svgStr = buildArtboardSVG(ab, drawingSvg, defsBlock);
      downloadBlob(new Blob([svgStr], { type: 'image/svg+xml' }), `${fileName}.svg`);
    } else {
      const svgStr = buildArtboardSVG(ab, drawingSvg, defsBlock);
      const blob = await rasterize(svgStr, ab.width, ab.height, scale, format);
      downloadBlob(blob, `${fileName}.${format}`);
    }

    // Small delay between downloads so browser doesn't block them
    if (artboards.length > 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

function buildArtboardSVG(ab: Artboard, drawingSvg: string, defsBlock: string): string {
  // Clip drawing content to the artboard bounds via a viewBox
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
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
