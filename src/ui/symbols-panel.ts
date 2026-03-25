import type { AppState } from '../core/state';

export function updateSymbolsPanel(state: AppState): void {
  const list = document.getElementById('symbols-list')!;
  list.innerHTML = '';

  for (const sym of state.symbols) {
    const li = document.createElement('li');
    li.className = 'layer-item';
    li.setAttribute('data-id', sym.id);

    const icon = document.createElement('span');
    icon.className = 'layer-icon';
    icon.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12"><rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1"/></svg>';

    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = sym.name;

    const placeBtn = document.createElement('button');
    placeBtn.className = 'symbol-place-btn';
    placeBtn.textContent = '+';
    placeBtn.title = 'Place instance';
    placeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.placeSymbolInstance(sym.id);
    });

    li.appendChild(icon);
    li.appendChild(name);
    li.appendChild(placeBtn);

    list.appendChild(li);
  }
}

export function setupSymbolButtons(state: AppState): void {
  document.getElementById('btn-create-symbol')!.addEventListener('click', () => {
    if (state.selectedShapeId) {
      state.createSymbolFromShape(state.selectedShapeId);
    }
  });

  document.getElementById('btn-detach-symbol')!.addEventListener('click', () => {
    if (state.selectedShapeId) {
      state.detachSymbolInstance(state.selectedShapeId);
    }
  });
}
