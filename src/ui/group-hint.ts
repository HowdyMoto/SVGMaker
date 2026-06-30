// A subtle, non-intrusive hint shown with the Select tool to teach group editing.
// It's context-aware: when a group is merely selected it teaches double-click to
// step inside; once you're inside a group it teaches Esc to step back out.
// Mirrors the gesture-HUD chip style but lives at the top of the canvas so it
// never collides with the bottom gesture HUD.

export type GroupHintMode = 'enter' | 'inside';

function chip(key: string, label: string): string {
  return `<span class="gesture-hud-chip"><kbd>${key}</kbd>`
    + `<span class="gesture-hud-label">${label}</span></span>`;
}

const CONTENT: Record<GroupHintMode, string> = {
  enter: chip('Double-click', 'select an item inside'),
  inside: chip('Esc', 'step back out'),
};

let currentMode: GroupHintMode | null = null;

export function showGroupHint(mode: GroupHintMode): void {
  const el = document.getElementById('group-hint');
  if (!el) return;
  if (currentMode !== mode) {
    currentMode = mode;
    el.innerHTML = CONTENT[mode];
  }
  el.hidden = false;
}

export function hideGroupHint(): void {
  const el = document.getElementById('group-hint');
  if (el) el.hidden = true;
  currentMode = null;
}
