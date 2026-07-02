import type { AppState } from '../core/state';
import type { ShapeData } from '../core/types';
import type { CommandContext } from '../commands';
import { runCommand } from '../commands';
import { showContextMenu, beginInlineRename } from './panel-helpers';
import { exportArtboardToFile } from './export-dialog';
import { ICON_EXPORT, ICON_EYE, ICON_EYE_OFF, ICON_LOCK, ICON_UNLOCK, getShapeIcon } from './icons';

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

// ---------------------------------------------------------------------------
// Virtualized rendering.
//
// The panel is a tree, but huge documents (e.g. a matplotlib export where every
// point is its own <g>) can have 100k+ rows. Rendering one <li> per shape builds
// ~1.8M DOM nodes and takes ~14s. Instead we flatten the *visible* tree (honoring
// collapse) into an array and render only the rows inside the scroll viewport,
// using top/bottom padding on the <ul> to preserve the scrollbar geometry.
// ---------------------------------------------------------------------------

interface LayerRow { shape: ShapeData; depth: number }

let vRows: LayerRow[] = [];      // flattened visible rows (cached between scrolls)
let vRowH = 0;                   // measured row height (uniform); 0 until first render
let curState: AppState | null = null;
let listEl: HTMLElement | null = null;
let scrollBound = false;
let pendingFrame = 0;
const BUFFER = 8;                // extra rows rendered above/below the viewport
const DEFAULT_ROW_H = 24;        // used for the first render, before measuring

/** Flatten the visible tree (collapsed groups hide their children) in render
 *  order — within each level, last shape first, matching the canvas z-order. */
function flattenVisible(list: ShapeData[], depth: number, out: LayerRow[]): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const sh = list[i];
    out.push({ shape: sh, depth });
    const isGroup = (sh.type === 'group' || sh.type === 'frame') && sh.children && sh.children.length > 0;
    if (isGroup && sh.element.getAttribute('data-collapsed') !== 'true') {
      flattenVisible(sh.children!, depth + 1, out);
    }
  }
}

/** Re-query the live name element by id so rename works after re-renders. */
function renameShape(id: string): void {
  if (!listEl || !curState) return;
  const nameEl = listEl.querySelector(`li[data-id="${CSS.escape(id)}"] .layer-name`) as HTMLElement | null;
  const shape = curState.findShapeById(id);
  if (!nameEl || !shape) return;
  beginInlineRename(nameEl, shape.name, (newName) => {
    shape.name = newName;
    shape.element.setAttribute('data-name', newName);
    curState!.onChange_public();
  });
}

/** Render just the rows currently in the viewport (from cached vRows). */
function renderWindow(): void {
  if (!listEl || !curState) return;
  const container = listEl.parentElement as HTMLElement | null;
  const total = vRows.length;
  const rowH = vRowH || DEFAULT_ROW_H;
  const scrollTop = container?.scrollTop ?? 0;
  const viewH = container?.clientHeight || 400;

  let start = Math.max(0, Math.floor(scrollTop / rowH) - BUFFER);
  let end = Math.min(total, Math.ceil((scrollTop + viewH) / rowH) + BUFFER);
  if (end < start) end = start;

  listEl.style.paddingTop = `${Math.round(start * rowH)}px`;
  listEl.style.paddingBottom = `${Math.round(Math.max(0, total - end) * rowH)}px`;

  const frag = document.createDocumentFragment();
  for (let i = start; i < end; i++) frag.appendChild(buildRow(vRows[i]));
  listEl.replaceChildren(frag);

  // Measure the real row height once, then re-window if our guess was off.
  if (!vRowH) {
    const first = listEl.firstElementChild as HTMLElement | null;
    if (first && first.offsetHeight > 0) {
      vRowH = first.offsetHeight;
      if (Math.abs(vRowH - rowH) > 0.5) renderWindow();
    }
  }
}

/** Bind scroll + resize once, so scrolling re-windows without re-flattening. */
function bindScroll(): void {
  if (scrollBound || !listEl) return;
  const container = listEl.parentElement;
  if (!container) return;
  const schedule = () => {
    if (pendingFrame) return;
    pendingFrame = requestAnimationFrame(() => { pendingFrame = 0; renderWindow(); });
  };
  container.addEventListener('scroll', schedule, { passive: true });
  new ResizeObserver(schedule).observe(container); // panel expand / window resize
  scrollBound = true;
}

export function updateLayersPanel(state: AppState): void {
  listEl = document.getElementById('layers-list');
  if (!listEl) return;
  curState = state;
  vRows = [];
  flattenVisible(state.shapes, 0, vRows);
  bindScroll();
  renderWindow();
}

/** Build one layer row (`<li>`); called only for rows in the viewport. */
function buildRow(row: LayerRow): HTMLLIElement {
  const state = curState!;
  const list = listEl!;
  const { shape, depth } = row;
  const isGroup = (shape.type === 'group' || shape.type === 'frame') && shape.children && shape.children.length > 0;
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

  // Visibility + lock toggles render FIRST, forming a fixed left column so
  // they (and any future per-layer toggles) line up across every row. The
  // disclosure arrow and tree indent sit to their right and never shift them.
  const vis = document.createElement('span');
  vis.className = 'layer-vis';
  vis.innerHTML = shape.visible ? ICON_EYE : ICON_EYE_OFF;
  vis.title = shape.visible ? 'Hide' : 'Show';
  vis.addEventListener('click', (e) => {
    e.stopPropagation();
    state.toggleVisibility(shape.id);
  });

  // Lock toggle — show a faded open padlock when unlocked so it's clickable.
  const lock = document.createElement('span');
  lock.className = shape.locked ? 'layer-lock' : 'layer-lock unlocked';
  lock.innerHTML = shape.locked ? ICON_LOCK : ICON_UNLOCK;
  lock.title = shape.locked ? 'Unlock' : 'Lock';
  lock.addEventListener('click', (e) => {
    e.stopPropagation();
    state.toggleLock(shape.id);
  });

  li.appendChild(vis);
  li.appendChild(lock);

  // Indent spacer — one per depth level (indents the disclosure/name, not the toggles)
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

  // Icon
  const icon = document.createElement('span');
  icon.className = 'layer-icon';
  icon.innerHTML = getShapeIcon(shape.type);

  // Name
  const name = document.createElement('span');
  name.className = 'layer-name';
  name.textContent = shape.name;

  li.appendChild(icon);
  li.appendChild(name);

  // Per-frame quick export (Figma-style): a download button on frame rows.
  if (shape.type === 'frame') {
    const exportBtn = document.createElement('button');
    exportBtn.className = 'layer-export';
    exportBtn.title = 'Export this frame as SVG';
    exportBtn.innerHTML = ICON_EXPORT;
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ab = state.getArtboardById(shape.id);
      if (ab) void exportArtboardToFile(state, ab);
    });
    li.appendChild(exportBtn);
  }

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
      ...(shape.type === 'frame' ? [{
        label: 'Export SVG…',
        action: () => { const ab = state.getArtboardById(shape.id); if (ab) void exportArtboardToFile(state, ab); },
      }] : []),
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

  return li;
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
