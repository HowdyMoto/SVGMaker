// ---------------------------------------------------------------------------
// Gesture hint HUD — a small, non-intrusive overlay that teaches the modifier
// keys and shortcuts available during a direct-manipulation gesture (moving,
// resizing, rotating, or drawing a shape).
//
// Shown at the bottom-centre of the canvas while a gesture is in progress. Each
// hint is a chip; modifier hints (Shift/⌘/⌥) light up the moment their key is
// held, so the HUD is both a reference ("what can I press?") and live feedback
// ("it's active now"). Action hints (↑↓, Enter, Esc) don't light up.
//
// The HUD tracks modifier state itself via window key listeners, so it updates
// even when the user presses a modifier without moving the mouse. Callers only
// need to showGestureHud() on each mousemove of a gesture and hideGestureHud()
// at the end — showing is idempotent.
// ---------------------------------------------------------------------------

export type GestureKind =
  | 'move' | 'resize' | 'rotate'              // select tool
  | 'rect' | 'ellipse' | 'line'              // shape drags with constraints
  | 'star' | 'polygon'                        // point/side count
  | 'pen';                                     // click-to-place (pen / polyline)

interface Mods { shift: boolean; mod: boolean; alt: boolean }
interface Hint { keys: string; label: string; active?: (m: Mods) => boolean }

const IS_MAC = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';
const ALT_KEY = IS_MAC ? '⌥' : 'Alt';

const HINTS: Record<GestureKind, Hint[]> = {
  move: [
    { keys: 'Shift', label: 'Straight', active: m => m.shift },
    { keys: MOD_KEY, label: 'Ignore guides', active: m => m.mod },
  ],
  resize: [
    { keys: 'Shift', label: 'Proportional', active: m => m.shift },
    { keys: MOD_KEY, label: 'Ignore guides', active: m => m.mod },
  ],
  rotate: [
    { keys: 'Shift', label: 'Snap 15°', active: m => m.shift },
  ],
  rect: [
    { keys: 'Shift', label: 'Square', active: m => m.shift },
    { keys: ALT_KEY, label: 'From center', active: m => m.alt },
  ],
  ellipse: [
    { keys: 'Shift', label: 'Circle', active: m => m.shift },
    { keys: ALT_KEY, label: 'From center', active: m => m.alt },
  ],
  line: [
    { keys: 'Shift', label: '45° angles', active: m => m.shift },
  ],
  star: [
    { keys: 'Shift', label: 'Regular', active: m => m.shift },
    { keys: ALT_KEY, label: 'From center', active: m => m.alt },
    { keys: '↑↓', label: 'Points' },
  ],
  polygon: [
    { keys: 'Shift', label: 'Regular', active: m => m.shift },
    { keys: ALT_KEY, label: 'From center', active: m => m.alt },
    { keys: '↑↓', label: 'Sides' },
  ],
  pen: [
    { keys: 'Enter', label: 'Finish' },
    { keys: 'Esc', label: 'Cancel' },
  ],
};

let currentKind: GestureKind | null = null;
// Chip elements for the current gesture, rebuilt only when the gesture changes;
// per-frame updates just toggle `.active` (cheap, and lets the highlight animate).
let chips: { el: HTMLElement; active?: (m: Mods) => boolean }[] = [];

function hudEl(): HTMLElement | null {
  return document.getElementById('gesture-hud');
}

function build(kind: GestureKind): void {
  const el = hudEl();
  if (!el) return;
  chips = HINTS[kind].map(hint => {
    const chip = document.createElement('span');
    chip.className = 'gesture-hud-chip';
    const kbd = document.createElement('kbd');
    kbd.textContent = hint.keys;
    const label = document.createElement('span');
    label.className = 'gesture-hud-label';
    label.textContent = hint.label;
    chip.append(kbd, label);
    return { el: chip, active: hint.active };
  });
  el.replaceChildren(...chips.map(c => c.el));
}

function paint(m: Mods): void {
  for (const c of chips) c.el.classList.toggle('active', !!c.active && c.active(m));
}

function modsOf(e: KeyboardEvent | MouseEvent): Mods {
  return { shift: e.shiftKey, mod: e.metaKey || e.ctrlKey, alt: e.altKey };
}

function onKey(e: KeyboardEvent): void {
  if (!currentKind) return;
  paint(modsOf(e));
}

/** Show (or refresh) the HUD for a gesture. Idempotent: safe to call on every
 *  mousemove. `e` supplies the current modifier state. */
export function showGestureHud(kind: GestureKind, e: MouseEvent | KeyboardEvent): void {
  const el = hudEl();
  if (!el) return;
  if (currentKind !== kind) {
    currentKind = kind;
    build(kind);
    el.hidden = false;
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
  }
  paint(modsOf(e));
}

export function hideGestureHud(): void {
  if (!currentKind) return;
  currentKind = null;
  chips = [];
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('keyup', onKey, true);
  const el = hudEl();
  if (el) { el.hidden = true; el.replaceChildren(); }
}
