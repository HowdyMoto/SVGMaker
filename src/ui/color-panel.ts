import type { AppState } from '../core/state';

export function setupColorPanel(state: AppState): void {
  const rSlider = document.getElementById('color-r') as HTMLInputElement;
  const gSlider = document.getElementById('color-g') as HTMLInputElement;
  const bSlider = document.getElementById('color-b') as HTMLInputElement;
  const rVal = document.getElementById('color-r-val') as HTMLInputElement;
  const gVal = document.getElementById('color-g-val') as HTMLInputElement;
  const bVal = document.getElementById('color-b-val') as HTMLInputElement;
  const hexInput = document.getElementById('color-hex') as HTMLInputElement;

  let editingFill = true; // true = editing fill, false = editing stroke

  const syncFromSliders = () => {
    const r = parseInt(rSlider.value);
    const g = parseInt(gSlider.value);
    const b = parseInt(bSlider.value);
    rVal.value = String(r);
    gVal.value = String(g);
    bVal.value = String(b);
    const hex = rgbToHex(r, g, b);
    hexInput.value = hex.toUpperCase();
    applyColor('#' + hex);
  };

  const syncFromVals = () => {
    const r = Math.max(0, Math.min(255, parseInt(rVal.value) || 0));
    const g = Math.max(0, Math.min(255, parseInt(gVal.value) || 0));
    const b = Math.max(0, Math.min(255, parseInt(bVal.value) || 0));
    rSlider.value = String(r);
    gSlider.value = String(g);
    bSlider.value = String(b);
    const hex = rgbToHex(r, g, b);
    hexInput.value = hex.toUpperCase();
    applyColor('#' + hex);
  };

  const syncFromHex = () => {
    const hex = hexInput.value.replace('#', '');
    if (hex.length !== 6) return;
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return;
    rSlider.value = String(r); rVal.value = String(r);
    gSlider.value = String(g); gVal.value = String(g);
    bSlider.value = String(b); bVal.value = String(b);
    applyColor('#' + hex);
  };

  const applyColor = (color: string) => {
    if (editingFill) {
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
  };

  rSlider.addEventListener('input', syncFromSliders);
  gSlider.addEventListener('input', syncFromSliders);
  bSlider.addEventListener('input', syncFromSliders);
  rVal.addEventListener('change', syncFromVals);
  gVal.addEventListener('change', syncFromVals);
  bVal.addEventListener('change', syncFromVals);
  hexInput.addEventListener('change', syncFromHex);

  // Clicking fill/stroke swatch in toolbar toggles which we're editing
  document.getElementById('tb-fill-swatch')?.addEventListener('click', () => { editingFill = true; updateColorFromState(state, true); });
  document.getElementById('tb-stroke-swatch')?.addEventListener('click', () => { editingFill = false; updateColorFromState(state, false); });
}

function updateColorFromState(state: AppState, isFill: boolean): void {
  const shape = state.getSelectedShape();
  const color = isFill
    ? (shape ? shape.style.fill : state.defaultStyle.fill)
    : (shape ? shape.style.stroke : state.defaultStyle.stroke);
  if (color === 'none') return;

  const hex = color.replace('#', '');
  if (hex.length !== 6) return;

  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  (document.getElementById('color-r') as HTMLInputElement).value = String(r);
  (document.getElementById('color-g') as HTMLInputElement).value = String(g);
  (document.getElementById('color-b') as HTMLInputElement).value = String(b);
  (document.getElementById('color-r-val') as HTMLInputElement).value = String(r);
  (document.getElementById('color-g-val') as HTMLInputElement).value = String(g);
  (document.getElementById('color-b-val') as HTMLInputElement).value = String(b);
  (document.getElementById('color-hex') as HTMLInputElement).value = hex.toUpperCase();
}

function rgbToHex(r: number, g: number, b: number): string {
  return [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}
