/**
 * Unity-style scrubbable numeric inputs — an app-wide design-system behavior.
 *
 * Two drag handles, both covering every `<input type="number">`:
 *   1. A `<label>` associated with the input (hover shows the resize cursor).
 *   2. The input itself, while it isn't focused — so label-less fields (stroke
 *      width, corner radius, …) are scrubbable too. A plain click still focuses
 *      it for typing; only a drag scrubs.
 *
 * The delta is *position-based* (proportional to how far you've dragged from the
 * start), NOT velocity-based — holding still holds the value, and dragging back
 * to the start restores the original number. Modifiers: Shift = ×10 (coarse),
 * Alt/Option = ×0.1 (fine).
 *
 * Wired through event delegation + a MutationObserver, so inputs created at
 * runtime (control-bar rebuilds, color picker, gradient stops, …) are covered
 * automatically. Values are written via the field's own `input`/`change` events,
 * so existing listeners react as if typed: `input` fires live during the drag,
 * one `change` fires on release.
 */

/** Pixels of horizontal drag that equal one `step` of the field, at ×1 speed. */
const PIXELS_PER_STEP = 4;
/** Drag must exceed this many px before it counts as a scrub (vs. a click). */
const DRAG_THRESHOLD = 3;

interface ScrubState {
  input: HTMLInputElement;
  startX: number;
  startVal: number;
  step: number;
  min: number;
  max: number;
  moved: boolean;
  /** True when the handle is a label (vs. dragging the input field itself). */
  fromLabel: boolean;
}

let active: ScrubState | null = null;

/** Resolve the number input a label drives, or null if it isn't one. */
function inputForLabel(label: HTMLLabelElement): HTMLInputElement | null {
  // Explicit association (for= or a wrapped control).
  const ctrl = label.control;
  if (ctrl) return ctrl instanceof HTMLInputElement && ctrl.type === 'number' ? ctrl : null;
  // Implicit: the next number input sibling (e.g. `<label>X</label><input …>`),
  // skipping inert spans/units but stopping at the next label.
  let n = label.nextElementSibling;
  while (n) {
    if (n instanceof HTMLInputElement) return n.type === 'number' ? n : null;
    if (n.tagName === 'LABEL') break;
    n = n.nextElementSibling;
  }
  return null;
}

/** Tag labels that drive number inputs so CSS can give them the scrub cursor. */
function markLabels(root: ParentNode): void {
  const labels = root instanceof HTMLLabelElement
    ? [root]
    : Array.from(root.querySelectorAll('label'));
  for (const l of labels) l.classList.toggle('num-scrub', !!inputForLabel(l));
}

/** Round to the step grid and format without floating-point dust. */
function snapFormat(val: number, snap: number): string {
  const snapped = Math.round(val / snap) * snap;
  const decimals = (String(snap).split('.')[1] ?? '').length;
  return snapped.toFixed(decimals);
}

function beginScrub(input: HTMLInputElement, startX: number, fromLabel: boolean): void {
  active = {
    input,
    startX,
    startVal: parseFloat(input.value) || 0,
    step: parseFloat(input.step) || 1,
    min: input.min !== '' ? parseFloat(input.min) : -Infinity,
    max: input.max !== '' ? parseFloat(input.max) : Infinity,
    moved: false,
    fromLabel,
  };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
}

function onPointerMove(e: PointerEvent): void {
  if (!active) return;
  const dx = e.clientX - active.startX;
  if (!active.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
  if (!active.moved) {
    active.moved = true;
    document.body.classList.add('num-scrubbing');
    // Dragging the field itself: drop focus + any text selection it grabbed on
    // mousedown so the scrub isn't fighting a caret.
    if (!active.fromLabel) {
      active.input.blur();
      window.getSelection?.()?.removeAllRanges();
    }
  }

  const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
  const snap = active.step * mult;
  let val = active.startVal + (dx / PIXELS_PER_STEP) * snap;
  val = Math.min(active.max, Math.max(active.min, val));
  active.input.value = snapFormat(val, snap);
  active.input.dispatchEvent(new Event('input', { bubbles: true }));
}

function onPointerUp(): void {
  window.removeEventListener('pointermove', onPointerMove);
  document.body.classList.remove('num-scrubbing');
  if (active?.moved) {
    active.input.dispatchEvent(new Event('change', { bubbles: true }));
    // Swallow the click that fires after a field drag so it doesn't focus the
    // input we just scrubbed.
    if (!active.fromLabel) suppressNextClick(active.input);
  }
  active = null;
}

function suppressNextClick(el: HTMLElement): void {
  const handler = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
  el.addEventListener('click', handler, { capture: true, once: true });
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0 || active) return;
  const target = e.target as Element;

  // 1) Label handle — always scrubs, even if the field is focused.
  const label = target.closest?.('label.num-scrub') as HTMLLabelElement | null;
  if (label) {
    const input = inputForLabel(label);
    if (input && !input.disabled && !input.readOnly) {
      e.preventDefault(); // suppress text selection / the label's default focus
      beginScrub(input, e.clientX, true);
    }
    return;
  }

  // 2) The number input itself — scrubs only while unfocused, so a click can
  //    still focus it for typing and the native spinner keeps working.
  if (
    target instanceof HTMLInputElement && target.type === 'number' &&
    !target.disabled && !target.readOnly && document.activeElement !== target
  ) {
    beginScrub(target, e.clientX, false); // no preventDefault — preserve click-to-focus
  }
}

/**
 * Enable scrubbable number inputs across the whole document. Call once at
 * startup; dynamically-added inputs are picked up automatically.
 */
export function setupNumberScrub(): void {
  markLabels(document);
  document.addEventListener('pointerdown', onPointerDown);

  // Re-tag labels as the UI rebuilds (control bar, color picker, panels, …).
  const observer = new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLElement) markLabels(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
