import type { AppState } from '../core/state';
import { showContextMenu, beginInlineRename } from './panel-helpers';

export function updateArtboardsPanel(state: AppState): void {
  const list = document.getElementById('artboards-list');
  if (!list) return;
  list.innerHTML = '';

  const renameArtboard = (id: string) => {
    const nameEl = list.querySelector(`li[data-ab-id="${id}"] .layer-name`) as HTMLElement | null;
    const ab = state.getArtboardById(id);
    if (!nameEl || !ab) return;
    beginInlineRename(nameEl, ab.name, (newName) => {
      ab.name = newName;
      state.onChange_public();
    });
  };

  for (const ab of state.artboards) {
    const li = document.createElement('li');
    li.className = 'layer-item';
    if (ab.id === state.activeArtboardId) li.classList.add('selected');
    li.setAttribute('data-ab-id', ab.id);

    const icon = document.createElement('span');
    icon.className = 'layer-icon';
    icon.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12"><rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2,1"/></svg>';

    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = ab.name;

    const dims = document.createElement('span');
    dims.className = 'layer-dims';
    dims.textContent = `${ab.width} × ${ab.height}`;
    dims.title = 'Edit position and size in the fields below';

    li.appendChild(icon);
    li.appendChild(name);
    li.appendChild(dims);

    li.addEventListener('click', () => {
      state.activePanel = 'artboards';
      state.setActiveArtboard(ab.id);
      state.selectedArtboardId = ab.id;
    });

    // Click the name of the active artboard to rename it.
    name.addEventListener('click', (e) => {
      if (state.activeArtboardId === ab.id) {
        e.stopPropagation();
        renameArtboard(ab.id);
      }
    });

    li.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      renameArtboard(ab.id);
    });

    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      state.activePanel = 'artboards';
      state.setActiveArtboard(ab.id);
      state.selectedArtboardId = ab.id;
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Rename', action: () => renameArtboard(ab.id) },
        { label: 'Duplicate', action: () => state.duplicateArtboard(ab.id) },
        { label: 'Delete', danger: true, action: () => state.removeArtboard(ab.id) },
      ]);
    });

    list.appendChild(li);
  }

  // Update artboard label in status bar
  const activeAb = state.getActiveArtboard();
  const labelEl = document.getElementById('artboard-label');
  if (labelEl) {
    labelEl.textContent = `${activeAb.name}: ${activeAb.width} × ${activeAb.height}`;
  }

  // Sync the X/Y/W/H editor strip to the active artboard. Skip the field the
  // user is currently typing in so we don't clobber it mid-edit.
  const props: Array<[string, number]> = [
    ['ab-prop-x', activeAb.x],
    ['ab-prop-y', activeAb.y],
    ['ab-prop-w', activeAb.width],
    ['ab-prop-h', activeAb.height],
  ];
  for (const [elId, val] of props) {
    const input = document.getElementById(elId) as HTMLInputElement | null;
    if (input && document.activeElement !== input) input.value = String(val);
  }
}

type AbField = 'x' | 'y' | 'width' | 'height';

/** Wire the labeled X/Y/W/H inputs that edit the active artboard's geometry. */
export function setupArtboardProps(state: AppState): void {
  const fields: Array<[AbField, string]> = [
    ['x', 'ab-prop-x'],
    ['y', 'ab-prop-y'],
    ['width', 'ab-prop-w'],
    ['height', 'ab-prop-h'],
  ];

  for (const [field, elId] of fields) {
    const input = document.getElementById(elId) as HTMLInputElement | null;
    if (!input) continue;

    input.addEventListener('input', () => {
      const ab = state.getActiveArtboard();
      if (!ab) return;
      let v = Math.round(parseFloat(input.value));
      if (!Number.isFinite(v)) return;
      if ((field === 'width' || field === 'height') && v < 1) v = 1;
      state.updateArtboard(ab.id, { [field]: v });
    });

    // Commit a single history checkpoint when the edit finishes.
    input.addEventListener('change', () => state.saveHistory());
  }
}

export function setupArtboardButtons(state: AppState): void {
  document.getElementById('btn-ab-add')?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.activePanel = 'artboards';
    const active = state.getActiveArtboard();
    // Place new artboard to the right of the rightmost artboard
    let maxRight = 0;
    for (const ab of state.artboards) {
      maxRight = Math.max(maxRight, ab.x + ab.width);
    }
    const gap = 40;
    state.addArtboard({
      id: state.nextArtboardId(),
      x: maxRight + gap,
      y: active.y,
      width: active.width,
      height: active.height,
      name: `Artboard ${state.artboards.length + 1}`,
    });
  });

  document.getElementById('btn-ab-delete')?.addEventListener('click', () => {
    if (state.activeArtboardId) {
      state.removeArtboard(state.activeArtboardId);
    }
  });
}
