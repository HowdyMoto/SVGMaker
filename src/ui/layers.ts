import type { AppState } from '../core/state';
import type { ShapeData } from '../core/types';
import type { CommandContext } from '../commands';
import { runCommand } from '../commands';
import { showContextMenu, beginInlineRename } from './panel-helpers';

// Id of the row currently being dragged in the Layers panel (null when idle).
let draggedId: string | null = null;

// 'inside' = into an existing group; 'onto' = wrap target + dragged in a new group.
type DropZone = 'before' | 'after' | 'inside' | 'onto';

/** Where a drop lands within a row: above/below, or onto the row to combine. */
function dropZone(e: DragEvent, li: HTMLElement, targetIsGroup: boolean): DropZone {
  const r = li.getBoundingClientRect();
  const y = e.clientY - r.top;
  if (y < r.height / 3) return 'before';
  if (y > (r.height * 2) / 3) return 'after';
  return targetIsGroup ? 'inside' : 'onto';
}

/** Both 'inside' and 'onto' highlight the whole row. */
function dropMark(zone: DropZone): string {
  return zone === 'before' || zone === 'after' ? `drop-${zone}` : 'drop-inside';
}

function clearDropMarks(li: HTMLElement): void {
  li.classList.remove('drop-before', 'drop-after', 'drop-inside');
}

// Signature of everything the layer rows render EXCEPT selection. When it's
// unchanged we can skip the full tree rebuild and just re-mark the selection.
let lastLayersSig: string | null = null;

function layersSignature(shapes: ShapeData[]): string {
  let s = '';
  const walk = (list: ShapeData[], depth: number) => {
    for (const sh of list) {
      const collapsed = sh.element.getAttribute('data-collapsed') === 'true' ? '1' : '0';
      const kids = sh.children?.length ?? 0;
      s += `${depth}:${sh.id}:${sh.type}:${sh.name}:${sh.visible ? 1 : 0}:${sh.locked ? 1 : 0}:${collapsed}:${kids};`;
      if (kids) walk(sh.children!, depth + 1);
    }
  };
  walk(shapes, 0);
  return s;
}

/** Re-apply just the `.selected` class to existing rows (fast path). */
function applyLayersSelection(list: HTMLElement, state: AppState): void {
  const sel = new Set(state.selectedShapeIds);
  if (state.selectedShapeId) sel.add(state.selectedShapeId);
  list.querySelectorAll('li.layer-item').forEach((li) => {
    const id = (li as HTMLElement).getAttribute('data-id');
    li.classList.toggle('selected', !!id && sel.has(id));
  });
}

export function updateLayersPanel(state: AppState): void {
  const list = document.getElementById('layers-list')!;

  // Fast path: structure unchanged (only selection could differ) → skip the
  // full innerHTML rebuild, which otherwise scales with total shape count and
  // fires on every move/select. Selection isn't part of the signature.
  const sig = layersSignature(state.shapes);
  if (sig === lastLayersSig && list.childElementCount > 0) {
    applyLayersSelection(list, state);
    return;
  }
  lastLayersSig = sig;

  list.innerHTML = '';

  // Re-query the live name element by id so rename works even after re-renders.
  const renameShape = (id: string) => {
    const nameEl = list.querySelector(`li[data-id="${id}"] .layer-name`) as HTMLElement | null;
    const shape = state.findShapeById(id);
    if (!nameEl || !shape) return;
    beginInlineRename(nameEl, shape.name, (newName) => {
      shape.name = newName;
      shape.element.setAttribute('data-name', newName);
      state.onChange_public();
    });
  };

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

      // Lock toggle — show a faded open padlock when unlocked so it's clickable.
      const lock = document.createElement('span');
      lock.className = shape.locked ? 'layer-lock' : 'layer-lock unlocked';
      lock.innerHTML = shape.locked ? '&#x1F512;' : '&#x1F513;';
      lock.title = shape.locked ? 'Unlock' : 'Lock';
      lock.addEventListener('click', (e) => {
        e.stopPropagation();
        state.toggleLock(shape.id);
      });

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
      li.appendChild(icon);
      li.appendChild(name);

      // Click to select
      li.addEventListener('click', (e) => {
        state.activePanel = 'layers';
        if (e.shiftKey) {
          state.toggleMultiSelect(shape.id);
        } else {
          state.selectShape(shape.id);
        }
      });

      // Click the name of an already-selected item to rename it (Finder-style).
      name.addEventListener('click', (e) => {
        const onlySelected = state.selectedShapeId === shape.id && state.selectedShapeIds.length <= 1;
        if (onlySelected) {
          e.stopPropagation();
          renameShape(shape.id);
        }
      });

      // Double-click to rename
      li.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        renameShape(shape.id);
      });

      // Right-click context menu
      li.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        state.activePanel = 'layers';
        showContextMenu(e.clientX, e.clientY, [
          { label: 'Rename', action: () => renameShape(shape.id) },
          { label: 'Delete', danger: true, action: () => state.removeShape(shape.id) },
        ]);
      });

      // Drag to reorder / reparent.
      li.draggable = true;
      li.addEventListener('dragstart', (e) => {
        draggedId = shape.id;
        e.dataTransfer!.effectAllowed = 'move';
        e.dataTransfer!.setData('text/plain', shape.id);
        li.classList.add('dragging');
      });
      li.addEventListener('dragend', () => {
        draggedId = null;
        list.querySelectorAll('.layer-item').forEach(el => {
          el.classList.remove('dragging');
          clearDropMarks(el as HTMLElement);
        });
      });
      li.addEventListener('dragover', (e) => {
        if (!draggedId || draggedId === shape.id) return;
        e.preventDefault();
        e.dataTransfer!.dropEffect = 'move';
        const zone = dropZone(e, li, shape.type === 'group');
        clearDropMarks(li);
        li.classList.add(dropMark(zone));
      });
      li.addEventListener('dragleave', () => clearDropMarks(li));
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        const zone = dropZone(e, li, shape.type === 'group');
        clearDropMarks(li);
        if (draggedId && draggedId !== shape.id) {
          if (zone === 'onto') state.groupShapes(draggedId, shape.id);
          else state.moveShape(draggedId, shape.id, zone);
        }
        draggedId = null;
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

export function setupLayerButtons(ctx: CommandContext): void {
  const state = ctx.state;
  document.getElementById('btn-layer-add')?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.activePanel = 'layers';
    state.addEmptyGroup();
  });
  document.getElementById('btn-layer-up')!.addEventListener('click', () => {
    state.activePanel = 'layers';
    runCommand('object.bring-forward', ctx);
  });
  document.getElementById('btn-layer-down')!.addEventListener('click', () => {
    state.activePanel = 'layers';
    runCommand('object.send-backward', ctx);
  });
  document.getElementById('btn-layer-duplicate')!.addEventListener('click', () => {
    state.activePanel = 'layers';
    runCommand('edit.duplicate', ctx);
  });
  document.getElementById('btn-layer-delete')!.addEventListener('click', () => {
    state.activePanel = 'layers';
    runCommand('edit.delete', ctx);
  });
}
