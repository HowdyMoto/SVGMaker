import type { AppState } from '../core/state';
import { exportSVG, importSVG } from './export';
import { showExportDialog } from './export-dialog';
import { saveProject, openProject } from './project-file';

export function setupMenus(state: AppState): void {
  const dropdowns = document.querySelectorAll('.menu-dropdown');

  dropdowns.forEach(dd => {
    const trigger = dd.querySelector('.menu-trigger')!;
    trigger.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const isOpen = dd.classList.contains('open');
      closeAllMenus();
      if (!isOpen) dd.classList.add('open');
    });
    trigger.addEventListener('mouseenter', () => {
      const anyOpen = document.querySelector('.menu-dropdown.open');
      if (anyOpen && anyOpen !== dd) {
        closeAllMenus();
        dd.classList.add('open');
      }
    });
  });

  document.addEventListener('mousedown', (e) => {
    if (!(e.target as Element).closest('.menu-dropdown')) {
      closeAllMenus();
    }
  });

  document.querySelectorAll('.menu-panel button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action')!;
      closeAllMenus();
      handleMenuAction(action, state);
    });
  });
}

function closeAllMenus(): void {
  document.querySelectorAll('.menu-dropdown').forEach(d => d.classList.remove('open'));
}

function handleMenuAction(action: string, state: AppState): void {
  switch (action) {
    case 'new': {
      if (state.shapes.length > 0 && !confirm('Clear canvas and start new?')) return;
      state.clearAll();
      break;
    }
    case 'open-project': openProject(state); break;
    case 'save-project': saveProject(state); break;
    case 'import': importSVG(state); break;
    case 'export': exportSVG(state); break;
    case 'export-all': showExportDialog(state); break;
    case 'undo': state.undo(); break;
    case 'redo': state.redo(); break;
    case 'duplicate':
      if (state.selectedShapeId) state.duplicateShape(state.selectedShapeId);
      break;
    case 'delete':
      if (state.selectedShapeId) state.removeShape(state.selectedShapeId);
      break;
    case 'select-all':
      if (state.shapes.length > 0) state.selectShape(state.shapes[state.shapes.length - 1].id);
      break;
    case 'deselect':
      state.selectShape(null);
      break;
    case 'bring-forward':
      if (state.selectedShapeId) state.moveShapeUp(state.selectedShapeId);
      break;
    case 'send-backward':
      if (state.selectedShapeId) state.moveShapeDown(state.selectedShapeId);
      break;
    case 'lock':
      if (state.selectedShapeId) state.toggleLock(state.selectedShapeId);
      break;
    case 'unlock-all':
      state.shapes.forEach(s => { s.locked = false; });
      state.onChange_public();
      break;
    case 'hide':
      if (state.selectedShapeId) state.toggleVisibility(state.selectedShapeId);
      break;
    case 'show-all':
      state.shapes.forEach(s => {
        s.visible = true;
        (s.element as SVGElement).style.display = '';
      });
      state.onChange_public();
      break;
    case 'toggle-grid': {
      const grid = document.getElementById('artboard-grid')!;
      grid.style.display = grid.style.display === 'none' ? '' : 'none';
      state.onChange_public();
      break;
    }
    case 'toggle-rulers': {
      const rulerH = document.getElementById('ruler-h')!;
      const rulerV = document.getElementById('ruler-v')!;
      const corner = document.getElementById('ruler-corner')!;
      const hidden = rulerH.classList.contains('hidden');
      rulerH.classList.toggle('hidden', !hidden);
      rulerV.classList.toggle('hidden', !hidden);
      corner.classList.toggle('hidden', !hidden);
      break;
    }
  }
}
