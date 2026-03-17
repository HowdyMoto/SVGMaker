import type { AppState } from '../core/state';

const SWATCHES = [
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

let currentOverlay: HTMLElement | null = null;
let currentTarget: 'fill' | 'stroke' = 'fill';

export function setupColorPicker(state: AppState): void {
  document.getElementById('prop-fill-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openPicker(state, 'fill', document.getElementById('prop-fill-btn')!);
  });

  document.getElementById('prop-stroke-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openPicker(state, 'stroke', document.getElementById('prop-stroke-btn')!);
  });
}

function openPicker(state: AppState, target: 'fill' | 'stroke', anchor: HTMLElement): void {
  // Close existing
  closePicker();
  currentTarget = target;

  const currentColor = getCurrentColor(state, target);

  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'cpicker-overlay';
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closePicker();
  });

  // Panel
  const panel = document.createElement('div');
  panel.className = 'cpicker-panel';

  // Position near anchor
  const rect = anchor.getBoundingClientRect();
  panel.style.top = `${rect.bottom + 4}px`;
  panel.style.left = `${Math.max(8, rect.left - 100)}px`;

  // Header
  const header = document.createElement('div');
  header.className = 'cpicker-header';
  header.textContent = target === 'fill' ? 'Fill Color' : 'Stroke Color';
  panel.appendChild(header);

  // Preview + hex row
  const previewRow = document.createElement('div');
  previewRow.className = 'cpicker-preview-row';

  const preview = document.createElement('div');
  preview.className = 'cpicker-preview';
  preview.style.background = currentColor === 'none' ? 'transparent' : currentColor;
  if (currentColor === 'none') preview.classList.add('cpicker-none');

  const hexWrap = document.createElement('div');
  hexWrap.className = 'cpicker-hex-wrap';
  const hashLabel = document.createElement('span');
  hashLabel.textContent = '#';
  hashLabel.className = 'cpicker-hash';
  const hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.maxLength = 6;
  hexInput.className = 'cpicker-hex';
  hexInput.value = colorToHex(currentColor);
  hexWrap.appendChild(hashLabel);
  hexWrap.appendChild(hexInput);

  previewRow.appendChild(preview);
  previewRow.appendChild(hexWrap);
  panel.appendChild(previewRow);

  // RGB sliders
  const rgb = hexToRgb(colorToHex(currentColor));
  const sliders: { label: string; slider: HTMLInputElement; val: HTMLInputElement }[] = [];

  for (const ch of ['R', 'G', 'B'] as const) {
    const row = document.createElement('div');
    row.className = 'cpicker-slider-row';

    const label = document.createElement('label');
    label.textContent = ch;
    label.className = 'cpicker-slider-label';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '255';
    slider.value = String(ch === 'R' ? rgb.r : ch === 'G' ? rgb.g : rgb.b);
    slider.className = 'cpicker-slider';

    const val = document.createElement('input');
    val.type = 'number';
    val.min = '0';
    val.max = '255';
    val.value = slider.value;
    val.className = 'cpicker-slider-val';

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(val);
    panel.appendChild(row);
    sliders.push({ label: ch, slider, val });
  }

  // Sync logic
  const syncFromSliders = () => {
    const r = parseInt(sliders[0].slider.value);
    const g = parseInt(sliders[1].slider.value);
    const b = parseInt(sliders[2].slider.value);
    sliders[0].val.value = String(r);
    sliders[1].val.value = String(g);
    sliders[2].val.value = String(b);
    const hex = rgbToHex(r, g, b);
    hexInput.value = hex.toUpperCase();
    preview.style.background = '#' + hex;
    preview.classList.remove('cpicker-none');
    applyColor(state, '#' + hex);
  };

  const syncFromVals = () => {
    const r = clamp(parseInt(sliders[0].val.value) || 0);
    const g = clamp(parseInt(sliders[1].val.value) || 0);
    const b = clamp(parseInt(sliders[2].val.value) || 0);
    sliders[0].slider.value = String(r);
    sliders[1].slider.value = String(g);
    sliders[2].slider.value = String(b);
    const hex = rgbToHex(r, g, b);
    hexInput.value = hex.toUpperCase();
    preview.style.background = '#' + hex;
    preview.classList.remove('cpicker-none');
    applyColor(state, '#' + hex);
  };

  const syncFromHex = () => {
    const hex = hexInput.value.replace('#', '');
    if (hex.length !== 6) return;
    const { r, g, b } = hexToRgb(hex);
    if (isNaN(r)) return;
    sliders[0].slider.value = String(r); sliders[0].val.value = String(r);
    sliders[1].slider.value = String(g); sliders[1].val.value = String(g);
    sliders[2].slider.value = String(b); sliders[2].val.value = String(b);
    preview.style.background = '#' + hex;
    preview.classList.remove('cpicker-none');
    applyColor(state, '#' + hex);
  };

  for (const s of sliders) {
    s.slider.addEventListener('input', syncFromSliders);
    s.val.addEventListener('change', syncFromVals);
  }
  hexInput.addEventListener('change', syncFromHex);

  // Divider
  const divider = document.createElement('div');
  divider.className = 'cpicker-divider';
  panel.appendChild(divider);

  // Swatches grid
  const grid = document.createElement('div');
  grid.className = 'cpicker-swatches';

  for (const color of SWATCHES) {
    const cell = document.createElement('div');
    cell.className = 'swatch-cell';
    if (color === 'none') {
      cell.classList.add('none-swatch');
    } else {
      cell.style.background = color;
    }
    cell.addEventListener('click', () => {
      if (color === 'none') {
        applyNone(state);
        preview.style.background = 'transparent';
        preview.classList.add('cpicker-none');
      } else {
        const hex = color.replace('#', '');
        hexInput.value = hex.toUpperCase();
        const { r, g, b } = hexToRgb(hex);
        sliders[0].slider.value = String(r); sliders[0].val.value = String(r);
        sliders[1].slider.value = String(g); sliders[1].val.value = String(g);
        sliders[2].slider.value = String(b); sliders[2].val.value = String(b);
        preview.style.background = color;
        preview.classList.remove('cpicker-none');
        applyColor(state, color);
      }
    });
    grid.appendChild(cell);
  }

  panel.appendChild(grid);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  currentOverlay = overlay;

  // Close on Escape
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { closePicker(); window.removeEventListener('keydown', onKey); }
  };
  window.addEventListener('keydown', onKey);
}

function closePicker(): void {
  if (currentOverlay) {
    currentOverlay.remove();
    currentOverlay = null;
  }
}

function applyColor(state: AppState, color: string): void {
  if (currentTarget === 'fill') {
    state.defaultStyle.fill = color;
    state.fillNone = false;
    const shape = state.getSelectedShape();
    if (shape) {
      shape.element.setAttribute('fill', color);
      shape.style.fill = color;
      state.saveHistory();
    }
  } else {
    state.defaultStyle.stroke = color;
    state.strokeNone = false;
    const shape = state.getSelectedShape();
    if (shape) {
      shape.element.setAttribute('stroke', color);
      shape.style.stroke = color;
      state.saveHistory();
    }
  }
  state.onChange_public();
}

function applyNone(state: AppState): void {
  if (currentTarget === 'fill') {
    state.fillNone = true;
    const shape = state.getSelectedShape();
    if (shape) {
      shape.element.setAttribute('fill', 'none');
      shape.style.fill = 'none';
      state.saveHistory();
    }
  } else {
    state.strokeNone = true;
    const shape = state.getSelectedShape();
    if (shape) {
      shape.element.setAttribute('stroke', 'none');
      shape.style.stroke = 'none';
      state.saveHistory();
    }
  }
  state.onChange_public();
}

function getCurrentColor(state: AppState, target: 'fill' | 'stroke'): string {
  const shape = state.getSelectedShape();
  if (target === 'fill') {
    return shape ? shape.style.fill : (state.fillNone ? 'none' : state.defaultStyle.fill);
  }
  return shape ? shape.style.stroke : (state.strokeNone ? 'none' : state.defaultStyle.stroke);
}

function colorToHex(color: string): string {
  if (color === 'none' || !color) return 'FFFFFF';
  return color.replace('#', '').toUpperCase();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  hex = hex.replace('#', '');
  if (hex.length !== 6) return { r: 255, g: 255, b: 255 };
  return {
    r: parseInt(hex.substring(0, 2), 16) || 0,
    g: parseInt(hex.substring(2, 4), 16) || 0,
    b: parseInt(hex.substring(4, 6), 16) || 0,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, v));
}
