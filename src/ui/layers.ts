import type { AppState } from '../core/state';

export function updateLayersPanel(state: AppState): void {
  const list = document.getElementById('layers-list')!;
  list.innerHTML = '';

  for (let i = state.shapes.length - 1; i >= 0; i--) {
    const shape = state.shapes[i];
    const li = document.createElement('li');
    li.className = 'layer-item';
    if (shape.id === state.selectedShapeId) li.classList.add('selected');
    li.setAttribute('data-id', shape.id);

    // Visibility toggle
    const vis = document.createElement('span');
    vis.className = 'layer-vis';
    vis.innerHTML = shape.visible ? '&#x1F441;' : '&#x2014;';
    vis.title = shape.visible ? 'Hide' : 'Show';
    vis.addEventListener('click', (e) => {
      e.stopPropagation();
      state.toggleVisibility(shape.id);
    });

    // Lock toggle
    const lock = document.createElement('span');
    lock.className = 'layer-lock';
    lock.innerHTML = shape.locked ? '&#x1F512;' : '';
    lock.title = shape.locked ? 'Unlock' : 'Lock';
    lock.addEventListener('click', (e) => {
      e.stopPropagation();
      state.toggleLock(shape.id);
    });

    // Color indicator
    const color = document.createElement('span');
    color.className = 'layer-color';

    // Icon
    const icon = document.createElement('span');
    icon.className = 'layer-icon';
    icon.innerHTML = getShapeIcon(shape.type);

    // Name
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = shape.name;

    li.appendChild(vis);
    li.appendChild(lock);
    li.appendChild(color);
    li.appendChild(icon);
    li.appendChild(name);

    li.addEventListener('click', () => {
      state.selectShape(shape.id);
    });

    li.addEventListener('dblclick', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = shape.name;
      input.className = 'layer-rename';
      name.replaceWith(input);
      input.focus();
      input.select();
      const finish = () => {
        shape.name = input.value || shape.name;
        shape.element.setAttribute('data-name', shape.name);
        state.onChange_public();
      };
      input.addEventListener('blur', finish);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { input.value = shape.name; input.blur(); }
      });
    });

    list.appendChild(li);
  }
}

function getShapeIcon(type: string): string {
  switch (type) {
    case 'rect': return '<svg viewBox="0 0 16 16" width="12" height="12"><rect x="2" y="3" width="12" height="10" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    case 'ellipse': return '<svg viewBox="0 0 16 16" width="12" height="12"><ellipse cx="8" cy="8" rx="6" ry="5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    case 'line': return '<svg viewBox="0 0 16 16" width="12" height="12"><line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" stroke-width="1.5"/></svg>';
    case 'polyline': return '<svg viewBox="0 0 16 16" width="12" height="12"><polyline points="2,14 6,4 10,10 14,2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    case 'polygon': return '<svg viewBox="0 0 16 16" width="12" height="12"><polygon points="8,2 14,6 12,14 4,14 2,6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    case 'path': return '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M2 14 Q8 2 14 8" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    case 'text': return '<svg viewBox="0 0 16 16" width="12" height="12"><text x="8" y="13" text-anchor="middle" font-size="12" font-weight="bold" fill="currentColor">T</text></svg>';
    default: return '';
  }
}

export function setupLayerButtons(state: AppState): void {
  document.getElementById('btn-layer-up')!.addEventListener('click', () => {
    if (state.selectedShapeId) state.moveShapeUp(state.selectedShapeId);
  });
  document.getElementById('btn-layer-down')!.addEventListener('click', () => {
    if (state.selectedShapeId) state.moveShapeDown(state.selectedShapeId);
  });
  document.getElementById('btn-layer-duplicate')!.addEventListener('click', () => {
    if (state.selectedShapeId) state.duplicateShape(state.selectedShapeId);
  });
  document.getElementById('btn-layer-delete')!.addEventListener('click', () => {
    if (state.selectedShapeId) state.removeShape(state.selectedShapeId);
  });
}
