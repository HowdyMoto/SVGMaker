import type { AppState } from '../core/state';

export function updateArtboardsPanel(state: AppState): void {
  const list = document.getElementById('artboards-list');
  if (!list) return;
  list.innerHTML = '';

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
    dims.textContent = `${ab.width} x ${ab.height}`;
    dims.style.cssText = 'color:#888; font-size:9px; margin-left:auto; flex-shrink:0;';

    li.appendChild(icon);
    li.appendChild(name);
    li.appendChild(dims);

    li.addEventListener('click', () => {
      state.setActiveArtboard(ab.id);
      state.selectedArtboardId = ab.id;
    });

    li.addEventListener('dblclick', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = ab.name;
      input.className = 'layer-rename';
      name.replaceWith(input);
      input.focus();
      input.select();
      const finish = () => {
        ab.name = input.value || ab.name;
        state.onChange_public();
      };
      input.addEventListener('blur', finish);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { input.value = ab.name; input.blur(); }
      });
    });

    list.appendChild(li);
  }

  // Update artboard label in status bar
  const activeAb = state.getActiveArtboard();
  const labelEl = document.getElementById('artboard-label');
  if (labelEl) {
    labelEl.textContent = `${activeAb.name}: ${activeAb.width} \u00D7 ${activeAb.height}`;
  }
}

export function setupArtboardButtons(state: AppState): void {
  document.getElementById('btn-ab-add')?.addEventListener('click', () => {
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
