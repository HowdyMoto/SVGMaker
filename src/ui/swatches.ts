import type { AppState } from '../core/state';

const DEFAULT_SWATCHES = [
  'none',
  '#FFFFFF', '#000000', '#333333', '#666666', '#999999', '#CCCCCC',
  '#FF0000', '#FF6600', '#FFCC00', '#FFFF00', '#99FF00', '#00FF00',
  '#00FF99', '#00FFFF', '#0099FF', '#0000FF', '#6600FF', '#FF00FF',
  '#CC0000', '#CC6600', '#CC9900', '#999900', '#669900', '#009900',
  '#009966', '#009999', '#006699', '#000099', '#660099', '#990066',
  '#990000', '#993300', '#996600', '#666600', '#336600', '#006600',
  '#006633', '#006666', '#003366', '#000066', '#330066', '#660033',
  '#FFB3B3', '#FFD9B3', '#FFF0B3', '#FFFFB3', '#D9FFB3', '#B3FFB3',
  '#B3FFD9', '#B3FFFF', '#B3D9FF', '#B3B3FF', '#D9B3FF', '#FFB3FF',
];

export function setupSwatches(state: AppState): void {
  const grid = document.getElementById('swatches-grid')!;

  for (const color of DEFAULT_SWATCHES) {
    const cell = document.createElement('div');
    cell.className = 'swatch-cell';
    if (color === 'none') {
      cell.classList.add('none-swatch');
    } else {
      cell.style.background = color;
    }
    cell.addEventListener('click', () => {
      if (color === 'none') {
        state.fillNone = true;
      } else {
        state.defaultStyle.fill = color;
        state.fillNone = false;
      }
      // Apply to selected shape
      const shape = state.getSelectedShape();
      if (shape) {
        if (color === 'none') {
          shape.element.setAttribute('fill', 'none');
          shape.style.fill = 'none';
        } else {
          shape.element.setAttribute('fill', color);
          shape.style.fill = color;
        }
        state.saveHistory();
      }
      state.onChange_public();
    });
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (color === 'none') {
        state.strokeNone = true;
      } else {
        state.defaultStyle.stroke = color;
        state.strokeNone = false;
      }
      const shape = state.getSelectedShape();
      if (shape) {
        if (color === 'none') {
          shape.element.setAttribute('stroke', 'none');
          shape.style.stroke = 'none';
        } else {
          shape.element.setAttribute('stroke', color);
          shape.style.stroke = color;
        }
        state.saveHistory();
      }
      state.onChange_public();
    });
    grid.appendChild(cell);
  }
}
