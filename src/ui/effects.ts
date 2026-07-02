/**
 * Effects panel — non-destructive blur and drop shadow on the selected object,
 * rendered via SVG filters. The state owns the filter generation (data-fx-* attrs
 * → <filter> in defs); this module is the Properties-panel UI:
 *  - a Blur slider,
 *  - a Drop Shadow toggle with colour, opacity, offset, and softness.
 *
 * Sliders apply live on `input` (no history) and commit once on `change`, so a
 * drag leaves a single undo step.
 */

import type { AppState } from '../core/state';
import type { ObjectShadow } from '../core/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function setupEffects(state: AppState): void {
  const blur = $<HTMLInputElement>('fx-blur');
  const blurVal = $<HTMLSpanElement>('fx-blur-val');
  const toggle = $<HTMLButtonElement>('fx-shadow-toggle');
  const color = $<HTMLInputElement>('fx-shadow-color');
  const opacity = $<HTMLInputElement>('fx-shadow-opacity');
  const dx = $<HTMLInputElement>('fx-shadow-dx');
  const dy = $<HTMLInputElement>('fx-shadow-dy');
  const soft = $<HTMLInputElement>('fx-shadow-blur');

  const hasSel = () => state.selectedShapeIds.length > 0;

  // Effects/blend/markers apply to the WHOLE selection in one undo step; the panel
  // reflects the primary (last-selected) object's values.

  // ---- Blur ----
  const applyBlur = (record: boolean) => {
    if (!hasSel()) return;
    blurVal.textContent = String(parseFloat(blur.value));
    state.setSelectionBlur(parseFloat(blur.value) || 0, record);
  };
  blur.addEventListener('input', () => applyBlur(false));
  blur.addEventListener('change', () => applyBlur(true));

  // ---- Drop shadow ----
  const readShadow = (): ObjectShadow => ({
    dx: parseFloat(dx.value) || 0,
    dy: parseFloat(dy.value) || 0,
    blur: parseFloat(soft.value) || 0,
    color: color.value || '#000000',
    opacity: parseFloat(opacity.value),
  });
  const applyShadow = (record: boolean) => {
    if (!hasSel()) return;
    state.setSelectionShadow(toggle.classList.contains('active') ? readShadow() : null, record);
  };

  toggle.addEventListener('click', () => {
    toggle.classList.toggle('active');
    updateEffectsPanel(state); // reveal/hide the param rows immediately
    applyShadow(true);
  });
  // Live-drag the opacity slider; commit on release. The rest are discrete.
  opacity.addEventListener('input', () => applyShadow(false));
  opacity.addEventListener('change', () => applyShadow(true));
  for (const inp of [color, dx, dy, soft]) inp.addEventListener('change', () => applyShadow(true));

  // ---- Blend mode ----
  $<HTMLSelectElement>('fx-blend').addEventListener('change', () => {
    if (hasSel()) state.setSelectionBlendMode($<HTMLSelectElement>('fx-blend').value);
  });
}

/** Reflect the selected object's effects into the panel (and show/hide rows). */
export function updateEffectsPanel(state: AppState): void {
  const effectsRow = document.getElementById('prop-effects-row');
  const shadowRow = document.getElementById('prop-shadow-row');
  const paramsRow = document.getElementById('prop-shadow-params');
  const blendRow = document.getElementById('prop-blend-row');
  if (!effectsRow || !shadowRow || !paramsRow || !blendRow) return;

  // Shown whenever ≥1 object is selected; the fields reflect the primary object,
  // edits apply to the whole selection.
  const single = state.selectedShapeIds.length >= 1 ? state.getSelectedShape() : null;
  if (!single) {
    effectsRow.style.display = 'none';
    shadowRow.style.display = 'none';
    paramsRow.style.display = 'none';
    blendRow.style.display = 'none';
    return;
  }
  effectsRow.style.display = '';
  shadowRow.style.display = '';
  blendRow.style.display = '';
  $<HTMLSelectElement>('fx-blend').value = state.getBlendMode(single.id);

  const fx = state.getObjectEffects(single.id);
  ($<HTMLInputElement>('fx-blur')).value = String(fx.blur);
  $<HTMLSpanElement>('fx-blur-val').textContent = String(fx.blur);

  const toggle = $<HTMLButtonElement>('fx-shadow-toggle');
  const on = !!fx.shadow;
  toggle.classList.toggle('active', on);
  paramsRow.style.display = on ? '' : 'none';
  if (fx.shadow) {
    $<HTMLInputElement>('fx-shadow-color').value = fx.shadow.color;
    $<HTMLInputElement>('fx-shadow-opacity').value = String(fx.shadow.opacity);
    $<HTMLInputElement>('fx-shadow-dx').value = String(fx.shadow.dx);
    $<HTMLInputElement>('fx-shadow-dy').value = String(fx.shadow.dy);
    $<HTMLInputElement>('fx-shadow-blur').value = String(fx.shadow.blur);
  }
}
