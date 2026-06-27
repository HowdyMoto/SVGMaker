/**
 * Pathfinder UI — the Boolean ops, designed to fix Illustrator's opaque version:
 * verbs with diagram icons (not cryptic glyphs), a LIVE hover preview that ghosts
 * the real result on canvas before you commit, and a Subtract "swap" that removes
 * the front/back guessing game.
 *
 * Two surfaces share one set of behaviors (see {@link wireBoolButton}):
 *  - a docked side panel (always visible, discoverable), and
 *  - a contextual popover that floats over the selection so the ops come to the
 *    artwork instead of the user hiking to the panel.
 *
 * Geometry lives in core/boolean.ts and state.ts; this module is presentation
 * and interaction only.
 */

import type { AppState } from '../core/state';
import type { BooleanOp } from '../core/boolean';
import { ensureBooleanEngine, booleanEngineReady } from '../core/boolean';

const PREVIEW_ATTR = 'data-boolean-preview';
const OPS: BooleanOp[] = ['unite', 'subtract', 'intersect', 'exclude', 'divide'];
let subtractSwapped = false;
let popover: HTMLDivElement | null = null;

export function setupPathfinder(state: AppState): void {
  // Docked panel buttons (icons authored in index.html).
  document.querySelectorAll<HTMLButtonElement>('.pathfinder-buttons button[data-bool]')
    .forEach((btn) => wireBoolButton(state, btn, btn.getAttribute('data-bool') as BooleanOp));

  document.getElementById('pf-swap')?.addEventListener('click', () => toggleSwap());
  document.getElementById('pf-flatten')?.addEventListener('click', () => flattenSelected(state));

  buildPopover(state);
}

/** Reflect the current selection in the docked panel's enabled/disabled state. */
export function updatePathfinderPanel(state: AppState): void {
  const canCombine = state.selectedShapeIds.length >= 2;
  document.querySelectorAll<HTMLButtonElement>('.pathfinder-buttons button[data-bool]')
    .forEach((btn) => { btn.disabled = !canCombine; });

  const isBoolean = state.getSelectedShape()?.type === 'boolean';
  const swap = document.getElementById('pf-swap') as HTMLButtonElement | null;
  if (swap) { swap.style.display = canCombine ? '' : 'none'; swap.classList.toggle('active', subtractSwapped); }
  const flatten = document.getElementById('pf-flatten') as HTMLButtonElement | null;
  if (flatten) flatten.style.display = isBoolean ? '' : 'none';

  const hint = document.getElementById('pf-hint');
  if (hint) {
    hint.textContent = canCombine ? '' : isBoolean ? 'Double-click to edit · Flatten to commit' : 'Select 2+ shapes';
    hint.style.display = hint.textContent ? '' : 'none';
  }
}

// ---- Contextual floating popover ----

/** Build the popover once and append it to the body (position: fixed). */
function buildPopover(state: AppState): void {
  if (popover) return;
  const el = document.createElement('div');
  el.id = 'pathfinder-popover';
  el.className = 'pathfinder-popover';
  el.hidden = true;
  // Don't let a click on the popover bubble out and clear the selection.
  el.addEventListener('mousedown', (e) => e.stopPropagation());

  for (const op of OPS) {
    const btn = document.createElement('button');
    btn.setAttribute('data-bool', op);
    const src = document.querySelector(`.pathfinder-buttons button[data-bool="${op}"]`);
    btn.innerHTML = src?.innerHTML ?? op;
    btn.title = src?.getAttribute('title') ?? op;
    wireBoolButton(state, btn, op);
    el.appendChild(btn);
  }

  const sep = document.createElement('span');
  sep.className = 'pf-pop-sep';
  el.appendChild(sep);

  const swap = document.createElement('button');
  swap.id = 'pf-pop-swap';
  swap.className = 'pf-pop-swap';
  swap.title = 'Swap which shape cuts (Subtract)';
  swap.innerHTML = '&#x21C4;';
  swap.addEventListener('click', () => toggleSwap());
  el.appendChild(swap);

  document.body.appendChild(el);
  popover = el;
}

/**
 * Show/position the popover over the current selection. Called from onStateChange
 * (selection/edit changes) and the canvas view-change hook (pan/zoom), so it
 * tracks the shapes as the canvas moves. Cheap; bails fast when not applicable.
 */
export function updatePathfinderPopover(state: AppState): void {
  const pop = popover;
  if (!pop) return;

  const show = state.currentTool === 'select'
    && !state.interactive
    && !state.editingPathId
    && !state.activeGroupId
    && state.selectedShapeIds.length >= 2;
  if (!show) { pop.hidden = true; return; }

  // Union of the selected elements' viewport rects → where to anchor.
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const id of state.selectedShapeIds) {
    const shape = state.findShapeById(id);
    if (!shape) continue;
    let rc: DOMRect;
    try { rc = (shape.element as unknown as SVGGraphicsElement).getBoundingClientRect(); } catch { continue; }
    if (!rc || (rc.width === 0 && rc.height === 0)) continue;
    left = Math.min(left, rc.left); top = Math.min(top, rc.top);
    right = Math.max(right, rc.right); bottom = Math.max(bottom, rc.bottom);
  }
  if (!Number.isFinite(left)) { pop.hidden = true; return; }

  // Sync swap state, then reveal so width/height can be measured.
  pop.querySelector('#pf-pop-swap')?.classList.toggle('active', subtractSwapped);
  pop.hidden = false;

  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const gap = 10;
  let x = (left + right) / 2 - pw / 2;
  let y = top - ph - gap;            // prefer above the selection
  if (y < 8) y = bottom + gap;       // flip below if there's no room
  x = Math.max(8, Math.min(x, window.innerWidth - pw - 8));
  y = Math.max(8, Math.min(y, window.innerHeight - ph - 8));
  pop.style.left = `${Math.round(x)}px`;
  pop.style.top = `${Math.round(y)}px`;
}

// ---- Shared behavior ----

function wireBoolButton(state: AppState, btn: HTMLButtonElement, op: BooleanOp): void {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    clearPreview();
    void state.booleanSelection(op, op === 'subtract' && subtractSwapped);
  });
  // Live preview: warm the engine on hover, then ghost the result on canvas.
  btn.addEventListener('mouseenter', () => {
    if (btn.disabled) return;
    const reverse = op === 'subtract' && subtractSwapped;
    if (booleanEngineReady()) { showPreview(state, op, reverse); return; }
    void ensureBooleanEngine().then(() => { if (btn.matches(':hover')) showPreview(state, op, reverse); });
  });
  btn.addEventListener('mouseleave', clearPreview);
}

function toggleSwap(): void {
  subtractSwapped = !subtractSwapped;
  document.getElementById('pf-swap')?.classList.toggle('active', subtractSwapped);
  document.getElementById('pf-pop-swap')?.classList.toggle('active', subtractSwapped);
}

function flattenSelected(state: AppState): void {
  const p = state.getSelectedShape();
  if (p?.type === 'boolean') state.flattenBoolean(p.id);
}

// ---- Preview ghost (drawn in drawing-layer space, never committed) ----

function showPreview(state: AppState, op: BooleanOp, reverse: boolean): void {
  clearPreview();
  const dl = document.getElementById('drawing-layer');
  if (!dl) return;
  const ds = state.previewSelectionBoolean(op, reverse);
  if (!ds.length) return;

  const SVG = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(SVG, 'g');
  g.setAttribute(PREVIEW_ATTR, '');
  g.setAttribute('pointer-events', 'none');
  for (const d of ds) {
    if (!d.trim()) continue;
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'rgba(45, 127, 249, 0.18)');
    p.setAttribute('fill-rule', 'evenodd');
    p.setAttribute('stroke', '#2d7ff9');
    p.setAttribute('stroke-width', '1.5');
    p.setAttribute('vector-effect', 'non-scaling-stroke');
    g.appendChild(p);
  }
  dl.appendChild(g);
}

function clearPreview(): void {
  document.querySelectorAll(`#drawing-layer [${PREVIEW_ATTR}]`).forEach((el) => el.remove());
}
