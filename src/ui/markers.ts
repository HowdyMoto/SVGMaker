/**
 * Markers panel — arrowheads / dots on the start and end of lines and open paths.
 * State owns the shared <marker> library (defs) + the marker-* attributes; this is
 * just the two Properties-panel dropdowns. Shown only for stroke-y open shapes.
 */

import type { AppState } from '../core/state';

const MARKERABLE = new Set(['line', 'polyline', 'path']);

export function setupMarkers(state: AppState): void {
  const start = document.getElementById('mk-start') as HTMLSelectElement | null;
  const end = document.getElementById('mk-end') as HTMLSelectElement | null;
  start?.addEventListener('change', () => {
    if (state.selectedShapeIds.length) state.setSelectionMarker('start', start.value || null);
  });
  end?.addEventListener('change', () => {
    if (state.selectedShapeIds.length) state.setSelectionMarker('end', end.value || null);
  });
}

export function updateMarkersPanel(state: AppState): void {
  const row = document.getElementById('prop-markers-row');
  if (!row) return;
  // Shown when the primary (last-selected) object is markerable; edits apply to
  // the whole selection (markers are inert on non-path shapes, so that's safe).
  const single = state.selectedShapeIds.length >= 1 ? state.getSelectedShape() : null;
  if (!single || !MARKERABLE.has(single.type)) { row.style.display = 'none'; return; }
  row.style.display = '';
  const m = state.getMarkers(single.id);
  (document.getElementById('mk-start') as HTMLSelectElement).value = m.start;
  (document.getElementById('mk-end') as HTMLSelectElement).value = m.end;
}
