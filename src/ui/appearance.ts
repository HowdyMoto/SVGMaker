/**
 * Fills & Strokes panel — Illustrator's stacked Appearance: the selected object's
 * fills and strokes as an editable, reorderable z-stack (top row = top layer).
 * Each layer has paint, opacity, and (for strokes) a weight; add/remove/reorder
 * and per-layer show/hide. The state owns the model (AppState.getAppearance /
 * setAppearance): a stack of one fill + one stroke stays a plain element, anything
 * richer becomes a `<g data-appearance>` wrapper — this module is purely the UI.
 *
 * Edits apply live on `input` (record=false) and commit one undo step on `change`,
 * so dragging a slider leaves a single history entry.
 */

import type { AppState } from '../core/state';
import type { AppearanceLayer } from '../core/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// A colour <input> only understands #rrggbb; gradients/patterns (url(...)) or
// named paints are shown with a neutral picker but their real value is preserved
// until the user actually edits the swatch.
const isHex = (p: string) => /^#[0-9a-fA-F]{6}$/.test(p);

export function setupAppearanceStack(state: AppState): void {
  const list = $<HTMLDivElement>('ap-list');

  const primaryId = (): string | null => {
    const s = state.getSelectedShape();
    return s ? s.id : null;
  };

  // Re-read the live stack, mutate it, push it back. `record` = commit to history.
  const mutate = (fn: (layers: AppearanceLayer[]) => void, record: boolean) => {
    const id = primaryId();
    if (!id) return;
    const layers = state.getAppearance(id);
    fn(layers);
    state.setAppearance(id, layers, record);
    // A wrap/unwrap or reorder changes the row set → re-render; a live paint drag
    // (record=false) leaves the rows intact, so only re-render on commits.
    if (record) updateAppearanceStack(state);
  };

  $<HTMLButtonElement>('ap-add-fill').addEventListener('click', () => {
    mutate(layers => layers.unshift({ t: 'fill', paint: '#888888', opacity: 1 }), true);
  });
  $<HTMLButtonElement>('ap-add-stroke').addEventListener('click', () => {
    mutate(layers => layers.unshift({ t: 'stroke', paint: '#000000', width: 1, opacity: 1 }), true);
  });

  // Event delegation on the list — rows are re-rendered on every structural edit.
  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    const row = btn.closest('.ap-row') as HTMLElement | null;
    if (!row) return;
    const i = parseInt(row.dataset.index || '-1', 10);
    if (i < 0) return;
    if (btn.classList.contains('ap-vis')) {
      mutate(layers => { const l = layers[i]; if (l) l.visible = l.visible === false; }, true);
    } else if (btn.classList.contains('ap-del')) {
      mutate(layers => { layers.splice(i, 1); }, true);
    } else if (btn.classList.contains('ap-up') && i > 0) {
      mutate(layers => { [layers[i - 1], layers[i]] = [layers[i], layers[i - 1]]; }, true);
    } else if (btn.classList.contains('ap-down')) {
      mutate(layers => { if (i < layers.length - 1) [layers[i + 1], layers[i]] = [layers[i], layers[i + 1]]; }, true);
    }
  });

  const onPaint = (row: HTMLElement, record: boolean) => {
    const i = parseInt(row.dataset.index || '-1', 10);
    if (i < 0) return;
    const color = (row.querySelector('.ap-color') as HTMLInputElement)?.value;
    const opacity = parseFloat((row.querySelector('.ap-opacity') as HTMLInputElement)?.value ?? '1');
    const widthInp = row.querySelector('.ap-width') as HTMLInputElement | null;
    const width = widthInp ? Math.max(0, parseFloat(widthInp.value) || 0) : undefined;
    mutate(layers => {
      const l = layers[i];
      if (!l) return;
      if (color) l.paint = color;
      l.opacity = isNaN(opacity) ? 1 : Math.min(1, Math.max(0, opacity));
      if (width !== undefined && l.t === 'stroke') l.width = width;
    }, record);
  };

  list.addEventListener('input', (e) => {
    const row = (e.target as HTMLElement).closest('.ap-row') as HTMLElement | null;
    if (row) onPaint(row, false);
  });
  list.addEventListener('change', (e) => {
    const row = (e.target as HTMLElement).closest('.ap-row') as HTMLElement | null;
    if (row) onPaint(row, true);
  });

  updateAppearanceStack(state);
}

/** Rebuild the stack rows for the primary selection (or show the empty hint). */
export function updateAppearanceStack(state: AppState): void {
  const panel = document.getElementById('panel-fills-strokes');
  const list = document.getElementById('ap-list');
  const empty = document.getElementById('ap-empty');
  if (!panel || !list || !empty) return;

  const shape = state.selectedShapeIds.length === 1 ? state.getSelectedShape() : null;
  // Meaningful only for objects that carry paint — hide for groups/frames/images.
  const paintable = shape && !['group', 'frame', 'image', 'use'].includes(shape.type);
  if (!paintable) {
    list.innerHTML = '';
    empty.style.display = '';
    empty.textContent = state.selectedShapeIds.length > 1
      ? 'Select a single object to stack fills & strokes.'
      : 'Select an object to stack fills & strokes.';
    return;
  }
  empty.style.display = 'none';

  const layers = state.getAppearance(shape!.id);
  list.innerHTML = layers.map((l, i) => rowHtml(l, i, layers.length)).join('');
}

function rowHtml(l: AppearanceLayer, i: number, n: number): string {
  const hidden = l.visible === false;
  const swatch = isHex(l.paint) ? l.paint : '#000000';
  const pct = Math.round((l.opacity ?? 1) * 100);
  const kind = l.t === 'fill' ? 'Fill' : 'Stroke';
  const widthCell = l.t === 'stroke'
    ? `<input type="number" class="ap-width" min="0" step="0.5" value="${l.width ?? 1}" title="Stroke weight" />`
    : '';
  return `
    <div class="ap-row${hidden ? ' ap-hidden' : ''}" data-index="${i}">
      <button class="ap-vis" title="${hidden ? 'Show' : 'Hide'} layer">${hidden ? EYE_OFF : EYE}</button>
      <span class="ap-kind">${kind}</span>
      <input type="color" class="ap-color" value="${swatch}" title="${kind} colour" />
      ${widthCell}
      <input type="range" class="ap-opacity" min="0" max="1" step="0.01" value="${l.opacity ?? 1}" title="Opacity — ${pct}%" />
      <span class="ap-reorder">
        <button class="ap-up" title="Move up"${i === 0 ? ' disabled' : ''}>&#x25B2;</button>
        <button class="ap-down" title="Move down"${i === n - 1 ? ' disabled' : ''}>&#x25BC;</button>
      </span>
      <button class="ap-del" title="Delete layer">&#x2715;</button>
    </div>`;
}

const EYE = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 3.5C4.5 3.5 1.7 6 1 8c.7 2 3.5 4.5 7 4.5s6.3-2.5 7-4.5c-.7-2-3.5-4.5-7-4.5z" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 3.5C4.5 3.5 1.7 6 1 8c.7 2 3.5 4.5 7 4.5s6.3-2.5 7-4.5c-.7-2-3.5-4.5-7-4.5z" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.5"/><line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" stroke-width="1.2"/></svg>';
