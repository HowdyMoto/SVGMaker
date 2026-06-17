import type { AppState } from '../core/state';
import { supportsFileSystemAccess, saveFilePicker, writeHandle, downloadFile } from '../core/file-access';

/**
 * Export the drawing as a TraceCraft-ready SVG.
 *
 * TraceCraft's parser only reads <svg viewBox> + raw <path d> values; it
 * ignores transforms, groups, <image>, fills/strokes, and non-path shapes.
 * So this export bakes every path's transform into its coordinates, drops
 * everything else, and normalizes the result to:
 *
 *   <svg viewBox="0 0 W H" xmlns="...">  (no width/height, diagonal ~= 700)
 *     <path d="M … Z"/>
 *
 * Output uses only M / L / C / Q / Z — affine-invariant commands that bake
 * trivially. Arc (A) commands are rejected because they don't transform
 * cleanly under rotation.
 */

const TARGET_DIAGONAL = 700;

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Tokenize a path `d` string into command letters and numbers. */
function tokenize(d: string): Array<string | number> {
  const re = /([MLHVZCSQTAmlhvzcsqta])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  const tokens: Array<string | number> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    tokens.push(m[1] !== undefined ? m[1] : parseFloat(m[2]));
  }
  return tokens;
}

/**
 * Parse `d`, convert every command to absolute, apply the affine matrix to
 * each coordinate, and re-emit using only M/L/C/Q/Z. Throws 'ARC' on A/a.
 */
function bakePath(d: string, m: DOMMatrix): string {
  const t = tokenize(d);
  const out: string[] = [];
  let i = 0;
  let cx = 0, cy = 0;   // current point (document space, pre-matrix)
  let sx = 0, sy = 0;   // subpath start
  let ctrlX = 0, ctrlY = 0; // previous bezier control point (for S/T reflection)
  let last = '';        // previous command letter (with original case)

  const P = (x: number, y: number): string => {
    const nx = m.a * x + m.c * y + m.e;
    const ny = m.b * x + m.d * y + m.f;
    return `${round(nx)} ${round(ny)}`;
  };
  const n = (): number => t[i++] as number;
  const more = (): boolean => typeof t[i] === 'number';

  while (i < t.length) {
    let cmd: string;
    if (typeof t[i] === 'string') {
      cmd = t[i] as string;
      i++;
    } else {
      // Implicit repeat of the previous command (moveto repeats as lineto).
      if (!last) throw new Error('Malformed path data');
      cmd = last === 'M' ? 'L' : last === 'm' ? 'l' : last;
    }
    const rel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();
    const prevWasCubic = last.toUpperCase() === 'C' || last.toUpperCase() === 'S';
    const prevWasQuad = last.toUpperCase() === 'Q' || last.toUpperCase() === 'T';

    switch (upper) {
      case 'M': {
        let x = n(), y = n();
        if (rel) { x += cx; y += cy; }
        cx = x; cy = y; sx = x; sy = y;
        out.push('M ' + P(x, y));
        while (more()) { // extra pairs after moveto are implicit linetos
          let lx = n(), ly = n();
          if (rel) { lx += cx; ly += cy; }
          cx = lx; cy = ly;
          out.push('L ' + P(lx, ly));
        }
        break;
      }
      case 'L': {
        let x = n(), y = n();
        if (rel) { x += cx; y += cy; }
        cx = x; cy = y;
        out.push('L ' + P(x, y));
        break;
      }
      case 'H': {
        let x = n();
        if (rel) x += cx;
        cx = x;
        out.push('L ' + P(cx, cy));
        break;
      }
      case 'V': {
        let y = n();
        if (rel) y += cy;
        cy = y;
        out.push('L ' + P(cx, cy));
        break;
      }
      case 'C': {
        let x1 = n(), y1 = n(), x2 = n(), y2 = n(), x = n(), y = n();
        if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
        out.push('C ' + P(x1, y1) + ' ' + P(x2, y2) + ' ' + P(x, y));
        ctrlX = x2; ctrlY = y2; cx = x; cy = y;
        break;
      }
      case 'S': {
        let x2 = n(), y2 = n(), x = n(), y = n();
        if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
        const x1 = prevWasCubic ? 2 * cx - ctrlX : cx;
        const y1 = prevWasCubic ? 2 * cy - ctrlY : cy;
        out.push('C ' + P(x1, y1) + ' ' + P(x2, y2) + ' ' + P(x, y));
        ctrlX = x2; ctrlY = y2; cx = x; cy = y;
        break;
      }
      case 'Q': {
        let x1 = n(), y1 = n(), x = n(), y = n();
        if (rel) { x1 += cx; y1 += cy; x += cx; y += cy; }
        out.push('Q ' + P(x1, y1) + ' ' + P(x, y));
        ctrlX = x1; ctrlY = y1; cx = x; cy = y;
        break;
      }
      case 'T': {
        let x = n(), y = n();
        if (rel) { x += cx; y += cy; }
        const x1 = prevWasQuad ? 2 * cx - ctrlX : cx;
        const y1 = prevWasQuad ? 2 * cy - ctrlY : cy;
        out.push('Q ' + P(x1, y1) + ' ' + P(x, y));
        ctrlX = x1; ctrlY = y1; cx = x; cy = y;
        break;
      }
      case 'Z': {
        out.push('Z');
        cx = sx; cy = sy;
        break;
      }
      case 'A':
        throw new Error('ARC');
      default:
        throw new Error('Unsupported path command: ' + cmd);
    }
    last = cmd;
  }
  return out.join(' ');
}

/**
 * Definition of done: the file TraceCraft reads must contain ZERO transforms,
 * exactly one <path>, and a viewBox — all orientation baked into the path
 * numbers. This guard fails loudly rather than ever shipping a broken file.
 */
function assertTraceCraftSafe(svg: string): void {
  if (/\btransform\s*=/.test(svg)) {
    throw new Error('Export aborted: the output still contains a transform attribute. Orientation must be baked into the path coordinates.');
  }
  if ((svg.match(/<path[\s/>]/g) || []).length !== 1) {
    throw new Error('Export aborted: expected exactly one <path> in the output.');
  }
  if (!/\bviewBox\s*=/.test(svg)) {
    throw new Error('Export aborted: the output is missing a viewBox.');
  }
}

/** Exact bounding box of a path `d` string via an offscreen element. */
function measureBBox(d: string): DOMRect | null {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  svg.appendChild(p);
  document.body.appendChild(svg);
  let box: DOMRect | null = null;
  try { box = p.getBBox(); } catch { box = null; }
  svg.remove();
  return box;
}

export async function exportTrack(state: AppState): Promise<void> {
  const drawingLayer = document.getElementById('drawing-layer') as unknown as SVGGElement | null;
  if (!drawingLayer) { alert('No drawing surface found.'); return; }

  const paths = Array.from(drawingLayer.querySelectorAll('path')) as SVGPathElement[];
  if (paths.length === 0) {
    alert('No <path> found. Trace the track centerline with the Path tool, then export.');
    return;
  }

  // 1) Bake each path's transform into absolute, document-space coordinates.
  const layerCTM = drawingLayer.getScreenCTM();
  if (!layerCTM) { alert('Could not read the canvas transform.'); return; }
  const layerInv = layerCTM.inverse();

  const bakedParts: string[] = [];
  for (const p of paths) {
    const screen = p.getScreenCTM();
    if (!screen) continue;
    const toDoc = layerInv.multiply(screen); // path-local -> document space
    try {
      bakedParts.push(bakePath(p.getAttribute('d') || '', toDoc));
    } catch (err) {
      if ((err as Error).message === 'ARC') {
        alert('This path uses arc (A) commands, which TraceCraft cannot follow.\nRe-trace the affected section with curves and export again.');
        return;
      }
      throw err;
    }
  }

  let combined = bakedParts.join(' ').trim();
  if (!combined) { alert('Nothing to export.'); return; }

  // 2) Normalize: move to the origin and scale so the diagonal is ~700.
  const box = measureBBox(combined);
  if (!box || box.width === 0 || box.height === 0) { alert('The path has no measurable area.'); return; }
  const scale = TARGET_DIAGONAL / Math.hypot(box.width, box.height);
  const normalize = new DOMMatrix([scale, 0, 0, scale, -scale * box.x, -scale * box.y]);
  combined = bakePath(combined, normalize);
  const w = round(box.width * scale);
  const h = round(box.height * scale);

  // 3) Warn about anything that would corrupt TraceCraft's single-path model.
  const subpaths = (combined.match(/M/g) || []).length;
  const closed = /Z\s*$/.test(combined);
  const warnings: string[] = [];
  if (paths.length > 1) warnings.push(`• ${paths.length} paths were merged. TraceCraft expects ONE track outline — any extra shapes (grid, kerbs, guides) will corrupt it.`);
  if (subpaths > 1) warnings.push(`• The outline has ${subpaths} separate subpaths. TraceCraft expects one continuous loop.`);
  if (!closed) warnings.push('• The outline is not closed (no Z). TraceCraft expects a closed loop.');
  if (warnings.length && !confirm('Heads up before exporting:\n\n' + warnings.join('\n\n') + '\n\nExport anyway?')) return;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <path d="${combined}"/>
</svg>
`;

  // Self-check: never ship a file with a transform / multiple paths / no viewBox.
  try {
    assertTraceCraftSafe(svg);
  } catch (err) {
    alert((err instanceof Error ? err.message : String(err)) + '\n\nThis is a bug — please report it.');
    return;
  }

  // 4) Save.
  const base = (state.artboard?.name || 'track').trim().replace(/\s+/g, '-').toLowerCase() || 'track';
  const filename = `${base}.svg`;
  const types = [{ description: 'SVG Image', accept: { 'image/svg+xml': ['.svg'] } }];

  if (supportsFileSystemAccess()) {
    try {
      const handle = await saveFilePicker(filename, types);
      if (handle) { await writeHandle(handle, svg); return; }
      return; // cancelled
    } catch (err) {
      alert('Failed to export: ' + (err instanceof Error ? err.message : String(err)));
      return;
    }
  }
  downloadFile(filename, svg, 'image/svg+xml');
}
