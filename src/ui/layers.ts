import type { AppState } from '../core/state';
import type { ShapeData } from '../core/types';

export function updateLayersPanel(state: AppState): void {
  const list = document.getElementById('layers-list')!;
  list.innerHTML = '';

  const renderShapes = (shapes: ShapeData[], depth: number) => {
    for (let i = shapes.length - 1; i >= 0; i--) {
      const shape = shapes[i];
      const isGroup = shape.type === 'group' && shape.children && shape.children.length > 0;
      const isCollapsed = shape.element.getAttribute('data-collapsed') === 'true';

      const li = document.createElement('li');
      li.className = 'layer-item';
      if (depth > 0) li.classList.add('layer-child');
      if (isGroup) li.classList.add('layer-group');
      if (shape.id === state.selectedShapeId || state.selectedShapeIds.includes(shape.id)) {
        li.classList.add('selected');
      }
      li.setAttribute('data-id', shape.id);
      li.setAttribute('data-depth', String(depth));

      // Indent spacer — one per depth level
      if (depth > 0) {
        const indent = document.createElement('span');
        indent.className = 'layer-indent';
        indent.style.width = `${depth * 14}px`;
        indent.style.minWidth = `${depth * 14}px`;
        // Draw tree guide lines
        for (let d = 0; d < depth; d++) {
          const guide = document.createElement('span');
          guide.className = 'layer-indent-guide';
          guide.style.left = `${d * 14 + 7}px`;
          indent.appendChild(guide);
        }
        li.appendChild(indent);
      }

      // Expand/collapse toggle for groups
      if (isGroup) {
        const toggle = document.createElement('span');
        toggle.className = 'layer-group-toggle';
        toggle.innerHTML = isCollapsed ? '&#x25B6;' : '&#x25BC;';
        toggle.title = isCollapsed ? 'Expand group' : 'Collapse group';
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          shape.element.setAttribute('data-collapsed', isCollapsed ? 'false' : 'true');
          state.onChange_public();
        });
        li.appendChild(toggle);
      } else if (depth > 0) {
        // Tree branch connector for non-group children
        const connector = document.createElement('span');
        connector.className = 'layer-tree-connector';
        li.appendChild(connector);
      }

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

      // Color indicator — change color for groups
      const color = document.createElement('span');
      color.className = 'layer-color';
      if (isGroup) color.classList.add('layer-color-group');

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

      // Click to select
      li.addEventListener('click', (e) => {
        if (e.shiftKey) {
          state.toggleMultiSelect(shape.id);
        } else {
          state.selectShape(shape.id);
        }
      });

      // Double-click to rename
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

      // Render children if group is expanded
      if (isGroup && !isCollapsed) {
        renderShapes(shape.children!, depth + 1);
      }
    }
  };

  renderShapes(state.shapes, 0);
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
    case 'group': return '<svg viewBox="0 0 16 16" width="12" height="12"><rect x="1" y="3" width="8" height="7" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="5" y="6" width="8" height="7" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
    case 'image': return '<svg viewBox="0 0 16 16" width="12" height="12"><rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="6" cy="6" r="1.5" fill="currentColor"/><polyline points="2,12 6,8 9,10 12,6 14,9" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
    case 'use': return '<svg viewBox="0 0 16 16" width="12" height="12"><rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
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
