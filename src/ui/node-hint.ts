// Contextual help for the Direct Selection (node-editing) tool. Mirrors the
// group-hint chip strip at the top of the canvas, teaching the path point-
// editing actions. Context-aware: before any node is selected it teaches how to
// select / add points; once nodes are selected it teaches move / convert /
// break / delete. Driven reactively from main.ts's onStateChange.

import type { AppState } from '../core/state';

export type NodeHintMode = 'idle' | 'selected';

const IS_MAC = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
const ALT = IS_MAC ? '⌥' : 'Alt';

function chip(key: string, label: string): string {
  return `<span class="gesture-hud-chip"><kbd>${key}</kbd>`
    + `<span class="gesture-hud-label">${label}</span></span>`;
}

const CONTENT: Record<NodeHintMode, string> = {
  idle:
    chip('Click', 'select point')
    + chip('Double-click', 'add point')
    + chip('Esc', 'finish'),
  selected:
    chip('Drag / Arrows', 'move')
    + chip('Double-click', 'smooth / corner')
    + chip(`${ALT}-drag`, 'break handle')
    + chip('Del', 'remove')
    + chip('Esc', 'finish'),
};

let currentMode: NodeHintMode | null = null;

function showNodeHint(mode: NodeHintMode): void {
  const el = document.getElementById('node-hint');
  if (!el) return;
  if (currentMode !== mode) {
    currentMode = mode;
    el.innerHTML = CONTENT[mode];
  }
  el.hidden = false;
}

export function hideNodeHint(): void {
  const el = document.getElementById('node-hint');
  if (el) el.hidden = true;
  currentMode = null;
}

/** Reflect the current node-edit state: shown while editing a path, with content
 *  switching on whether any nodes are selected; hidden otherwise. */
export function updateNodeHint(state: AppState): void {
  if (!state.editingPathId || !state.pathEdit) { hideNodeHint(); return; }
  showNodeHint(state.pathEdit.selected.size > 0 ? 'selected' : 'idle');
}
