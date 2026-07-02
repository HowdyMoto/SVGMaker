// ---------------------------------------------------------------------------
// Frame panel — shown when a single Frame is selected. Houses the frame's editor
// guides (Figma's Layout Grid + rulers): add/remove a uniform grid, set its size,
// subdivisions and colour, show/hide it, snap to it, and toggle edge rulers.
// The state owns the model (per-frame data-* attributes); this is just the UI.
// ---------------------------------------------------------------------------

import type { AppState } from '../core/state';
import type { FrameGrid } from '../core/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const DEFAULT_GRID: FrameGrid = { size: 8, subdivisions: 4, color: '#7f8fa6', visible: true, snap: true };

/** The single selected frame's id, or null. */
function selectedFrameId(state: AppState): string | null {
  if (state.selectedShapeIds.length !== 1) return null;
  const s = state.getSelectedShape();
  return s && s.type === 'frame' ? s.id : null;
}

export function setupFramePanel(state: AppState): void {
  const id = () => selectedFrameId(state);

  // Read the current field values into a FrameGrid.
  const readGrid = (base: FrameGrid): FrameGrid => ({
    size: Math.max(1, parseFloat($<HTMLInputElement>('fp-grid-size').value) || base.size),
    subdivisions: Math.max(1, Math.round(parseFloat($<HTMLInputElement>('fp-grid-subdiv').value) || base.subdivisions)),
    color: $<HTMLInputElement>('fp-grid-color').value || base.color,
    visible: base.visible,
    snap: base.snap,
  });

  const commitGrid = (mut: (g: FrameGrid) => FrameGrid, record: boolean) => {
    const fid = id(); if (!fid) return;
    const cur = state.getFrameGrid(fid) ?? DEFAULT_GRID;
    state.setFrameGrid(fid, mut(cur), record);
    updateFramePanel(state);
  };

  $<HTMLButtonElement>('fp-rulers').addEventListener('click', () => {
    const fid = id(); if (!fid) return;
    state.setFrameRulers(fid, !state.getFrameRulers(fid));
    updateFramePanel(state);
  });

  $<HTMLButtonElement>('fp-grid-add').addEventListener('click', () => commitGrid(() => ({ ...DEFAULT_GRID }), true));
  $<HTMLButtonElement>('fp-grid-remove').addEventListener('click', () => {
    const fid = id(); if (!fid) return;
    state.setFrameGrid(fid, null, true);
    updateFramePanel(state);
  });
  $<HTMLButtonElement>('fp-grid-vis').addEventListener('click', () => commitGrid(g => ({ ...g, visible: !g.visible }), true));
  $<HTMLButtonElement>('fp-grid-snap').addEventListener('click', () => commitGrid(g => ({ ...g, snap: !g.snap }), true));

  // Size / subdivisions / colour: live on input, one undo step on change.
  const live = (id2: string, ev: 'input' | 'change', record: boolean) =>
    $<HTMLInputElement>(id2).addEventListener(ev, () => commitGrid(g => readGrid(g), record));
  for (const f of ['fp-grid-size', 'fp-grid-subdiv']) { live(f, 'input', false); live(f, 'change', true); }
  live('fp-grid-color', 'input', false);
  live('fp-grid-color', 'change', true);

  updateFramePanel(state);
}

/** Show/hide the Frame panel for the current selection and sync its controls. */
export function updateFramePanel(state: AppState): void {
  const panel = document.getElementById('panel-frame');
  if (!panel) return;
  const fid = selectedFrameId(state);
  if (!fid) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  const rulersOn = state.getFrameRulers(fid);
  const rBtn = $<HTMLButtonElement>('fp-rulers');
  rBtn.classList.toggle('active', rulersOn);
  rBtn.textContent = rulersOn ? 'On' : 'Off';

  const grid = state.getFrameGrid(fid);
  $<HTMLButtonElement>('fp-grid-add').style.display = grid ? 'none' : '';
  $<HTMLButtonElement>('fp-grid-remove').style.display = grid ? '' : 'none';
  $<HTMLDivElement>('fp-grid-fields').style.display = grid ? '' : 'none';
  if (grid) {
    $<HTMLInputElement>('fp-grid-size').value = String(grid.size);
    $<HTMLInputElement>('fp-grid-subdiv').value = String(grid.subdivisions);
    $<HTMLInputElement>('fp-grid-color').value = /^#[0-9a-fA-F]{6}$/.test(grid.color) ? grid.color : '#7f8fa6';
    const vis = $<HTMLButtonElement>('fp-grid-vis');
    vis.classList.toggle('active', grid.visible);
    vis.title = grid.visible ? 'Hide grid' : 'Show grid';
    const snap = $<HTMLButtonElement>('fp-grid-snap');
    snap.classList.toggle('active', grid.snap);
    snap.textContent = grid.snap ? 'On' : 'Off';
  }
}
