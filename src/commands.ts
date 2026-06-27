// ---------------------------------------------------------------------------
// Command registry — the single source of truth for every document/app action.
//
// Menus, keyboard shortcuts, the status bar and panel buttons all dispatch
// through this table instead of re-implementing the same operations. Adding a
// command here automatically gives it a menu hint (rendered from `accel`),
// keyboard binding, and enable/disable state — so the three surfaces can no
// longer drift apart the way hand-wired handlers do.
// ---------------------------------------------------------------------------

import type { AppState } from './core/state';
import type { CanvasController } from './core/canvas';
import type { ToolName } from './core/types';
import { exportSVG, importSVG } from './ui/export';
import { showExportDialog } from './ui/export-dialog';
import { exportTrack } from './ui/export-track';
import { showAboutDialog } from './ui/about-dialog';
import { pickAndImportImage } from './ui/import-image';
import {
  saveProject,
  saveProjectAs,
  openProject,
  resetProjectFile,
  confirmDiscard,
} from './ui/project-file';

/** Everything a command needs to run. Built once by main.ts and reused. */
export interface CommandContext {
  state: AppState;
  canvas: CanvasController;
  setTool: (tool: ToolName) => void;
  getArtboardsBounds: () => { x: number; y: number; w: number; h: number };
  /** Open the command palette. Wired up by main.ts after the palette exists. */
  openCommandPalette: () => void;
}

export type CommandKind = 'action' | 'toggle' | 'tool';

export interface Command {
  id: string;
  label: string;
  kind: CommandKind;
  /** Accelerator(s) in canonical form, e.g. 'Mod+Shift+S'. First is shown in menus. */
  accel?: string | string[];
  /** When present and false, the command is greyed out and refuses to run. */
  enabled?: (c: CommandContext) => boolean;
  /** For toggles: whether the toggle is currently on (drives the menu checkmark). */
  checked?: (c: CommandContext) => boolean;
  run: (c: CommandContext) => void;
}

// ---- Shared enable predicates ----------------------------------------------

const hasSelection = (c: CommandContext): boolean => c.state.selectedShapeIds.length > 0;
const primary = (c: CommandContext) => c.state.getSelectedShape();

// ---- The commands ----------------------------------------------------------

export const COMMANDS: Command[] = [
  // ---- App ----
  { id: 'app.command-palette', label: 'Command Palette…', kind: 'action', accel: 'Mod+K', run: (c) => c.openCommandPalette() },
  { id: 'app.about', label: 'About SVGMaker…', kind: 'action', run: () => showAboutDialog() },

  // ---- File ----
  {
    id: 'file.new', label: 'New', kind: 'action', accel: 'Mod+N',
    run: (c) => {
      if (!confirmDiscard(c.state)) return;
      c.state.clearAll();
      resetProjectFile();
      c.state.markClean();
    },
  },
  { id: 'file.open', label: 'Open…', kind: 'action', accel: 'Mod+O', run: (c) => openProject(c.state) },
  { id: 'file.save', label: 'Save', kind: 'action', accel: 'Mod+S', run: (c) => saveProject(c.state) },
  { id: 'file.save-as', label: 'Save As…', kind: 'action', run: (c) => saveProjectAs(c.state) },
  { id: 'file.import-svg', label: 'Append SVG…', kind: 'action', run: (c) => importSVG(c.state) },
  { id: 'file.import-image', label: 'Append Image…', kind: 'action', run: (c) => pickAndImportImage(c.state) },
  {
    id: 'file.export-svg', label: 'Export Active Artboard…', kind: 'action',
    accel: ['Mod+Shift+S', 'Mod+E'], run: (c) => { void exportSVG(c.state); },
  },
  { id: 'file.export-artboards', label: 'Export Artboards…', kind: 'action', accel: 'Mod+Alt+E', run: (c) => showExportDialog(c.state) },
  { id: 'file.export-tracecraft', label: 'Export for TraceCraft…', kind: 'action', run: (c) => exportTrack(c.state) },
  {
    id: 'export.bake-transforms', label: 'Bake Transforms on Export', kind: 'toggle',
    checked: (c) => c.state.bakeTransformsOnExport,
    run: (c) => {
      c.state.bakeTransformsOnExport = !c.state.bakeTransformsOnExport;
      try { localStorage.setItem('svgmaker.bakeTransforms', String(c.state.bakeTransformsOnExport)); } catch { /* ignore */ }
    },
  },

  // ---- Edit ----
  { id: 'edit.undo', label: 'Undo', kind: 'action', accel: 'Mod+Z', enabled: (c) => c.state.canUndo, run: (c) => { c.state.undo(); } },
  { id: 'edit.redo', label: 'Redo', kind: 'action', accel: ['Mod+Shift+Z', 'Mod+Y'], enabled: (c) => c.state.canRedo, run: (c) => { c.state.redo(); } },
  { id: 'edit.cut', label: 'Cut', kind: 'action', accel: 'Mod+X', enabled: hasSelection, run: (c) => c.state.cutSelected() },
  { id: 'edit.copy', label: 'Copy', kind: 'action', accel: 'Mod+C', enabled: hasSelection, run: (c) => c.state.copySelected() },
  {
    id: 'edit.paste', label: 'Paste', kind: 'action', accel: 'Mod+V',
    // Internal clipboard first (keeps in-app paste offset); otherwise try the
    // system clipboard so SVG copied from other apps can be pasted in.
    run: (c) => { if (!c.state.pasteClipboard()) void c.state.pasteFromSystemClipboard(); },
  },
  { id: 'edit.duplicate', label: 'Duplicate', kind: 'action', accel: 'Mod+D', enabled: hasSelection, run: (c) => c.state.duplicateSelected() },
  {
    id: 'edit.delete', label: 'Delete', kind: 'action', accel: ['Delete', 'Backspace'],
    enabled: (c) => {
      const s = c.state;
      if (s.activePanel === 'artboards') return !!s.activeArtboardId && s.artboards.length > 1;
      if (s.activePanel === 'symbols') return !!s.selectedSymbolId;
      return hasSelection(c);
    },
    run: (c) => {
      const s = c.state;
      if (s.activePanel === 'artboards') { if (s.activeArtboardId) s.removeArtboard(s.activeArtboardId); return; }
      if (s.activePanel === 'symbols') { if (s.selectedSymbolId) s.removeSymbol(s.selectedSymbolId); return; }
      s.removeSelected();
    },
  },
  { id: 'edit.select-all', label: 'Select All', kind: 'action', accel: 'Mod+A', enabled: (c) => c.state.shapes.length > 0, run: (c) => c.state.selectMultiple(c.state.shapes.map(s => s.id)) },
  { id: 'edit.deselect', label: 'Deselect', kind: 'action', accel: 'Mod+Shift+A', enabled: hasSelection, run: (c) => c.state.selectShape(null) },

  // ---- Object ----
  { id: 'object.group', label: 'Group', kind: 'action', accel: 'Mod+G', enabled: (c) => c.state.selectedShapeIds.length >= 2, run: (c) => c.state.groupSelectedShapes() },
  { id: 'object.ungroup', label: 'Ungroup', kind: 'action', accel: 'Mod+Shift+G', enabled: (c) => primary(c)?.type === 'group', run: (c) => { const p = primary(c); if (p) c.state.ungroupShape(p.id); } },
  { id: 'object.bring-to-front', label: 'Bring to Front', kind: 'action', accel: 'Mod+Shift+]', enabled: hasSelection, run: (c) => c.state.bringToFront() },
  { id: 'object.bring-forward', label: 'Bring Forward', kind: 'action', accel: 'Mod+]', enabled: hasSelection, run: (c) => { const p = primary(c); if (p) c.state.moveShapeUp(p.id); } },
  { id: 'object.send-backward', label: 'Send Backward', kind: 'action', accel: 'Mod+[', enabled: hasSelection, run: (c) => { const p = primary(c); if (p) c.state.moveShapeDown(p.id); } },
  { id: 'object.send-to-back', label: 'Send to Back', kind: 'action', accel: 'Mod+Shift+[', enabled: hasSelection, run: (c) => c.state.sendToBack() },
  { id: 'object.toggle-lock', label: 'Lock', kind: 'action', accel: 'Mod+2', enabled: hasSelection, run: (c) => { const p = primary(c); if (p) c.state.toggleLock(p.id); } },
  { id: 'object.unlock-all', label: 'Unlock All', kind: 'action', accel: 'Mod+Alt+2', run: (c) => c.state.unlockAll() },
  { id: 'object.toggle-visibility', label: 'Hide', kind: 'action', accel: 'Mod+3', enabled: hasSelection, run: (c) => { const p = primary(c); if (p) c.state.toggleVisibility(p.id); } },
  { id: 'object.show-all', label: 'Show All', kind: 'action', accel: 'Mod+Alt+3', run: (c) => c.state.showAll() },
  { id: 'object.create-symbol', label: 'Create Symbol', kind: 'action', enabled: hasSelection, run: (c) => { const p = primary(c); if (p) c.state.createSymbolFromShape(p.id); } },
  { id: 'object.detach-symbol', label: 'Detach Instance', kind: 'action', enabled: (c) => primary(c)?.type === 'use', run: (c) => { const p = primary(c); if (p) c.state.detachSymbolInstance(p.id); } },

  // ---- Path (Pathfinder / boolean) ----
  { id: 'path.unite', label: 'Unite', kind: 'action', accel: 'Mod+Alt+U', enabled: (c) => c.state.selectedShapeIds.length >= 2, run: (c) => { void c.state.booleanSelection('unite'); } },
  { id: 'path.subtract', label: 'Subtract', kind: 'action', accel: 'Mod+Alt+S', enabled: (c) => c.state.selectedShapeIds.length >= 2, run: (c) => { void c.state.booleanSelection('subtract'); } },
  { id: 'path.intersect', label: 'Intersect', kind: 'action', accel: 'Mod+Alt+I', enabled: (c) => c.state.selectedShapeIds.length >= 2, run: (c) => { void c.state.booleanSelection('intersect'); } },
  { id: 'path.exclude', label: 'Exclude', kind: 'action', accel: 'Mod+Alt+X', enabled: (c) => c.state.selectedShapeIds.length >= 2, run: (c) => { void c.state.booleanSelection('exclude'); } },
  { id: 'path.divide', label: 'Divide', kind: 'action', enabled: (c) => c.state.selectedShapeIds.length >= 2, run: (c) => { void c.state.booleanSelection('divide'); } },
  { id: 'path.flatten', label: 'Flatten Compound Shape', kind: 'action', enabled: (c) => primary(c)?.type === 'boolean', run: (c) => { const p = primary(c); if (p) c.state.flattenBoolean(p.id); } },

  // ---- View ----
  { id: 'view.zoom-in', label: 'Zoom In', kind: 'action', accel: ['Mod+=', 'Mod+Shift+='], run: (c) => c.canvas.setZoom(c.canvas.getZoom() * 1.25) },
  { id: 'view.zoom-out', label: 'Zoom Out', kind: 'action', accel: 'Mod+-', run: (c) => c.canvas.setZoom(c.canvas.getZoom() / 1.25) },
  { id: 'view.zoom-fit', label: 'Fit Artboard', kind: 'action', accel: 'Mod+0', run: (c) => c.canvas.fitToWindow(c.getArtboardsBounds()) },
  { id: 'view.zoom-100', label: 'Actual Size', kind: 'action', accel: 'Mod+1', run: (c) => c.canvas.setZoom(1) },
  {
    id: 'view.toggle-transparency', label: 'Show Transparency', kind: 'toggle',
    checked: (c) => c.state.showTransparency,
    run: (c) => { c.state.showTransparency = !c.state.showTransparency; c.state.onChange_public(); },
  },
  {
    id: 'view.toggle-grid', label: 'Show Grid', kind: 'toggle', accel: "Mod+'",
    checked: () => { const g = document.getElementById('artboard-grid'); return !!g && g.style.display !== 'none'; },
    run: (c) => {
      const grid = document.getElementById('artboard-grid');
      if (grid) grid.style.display = grid.style.display === 'none' ? '' : 'none';
      c.state.onChange_public();
    },
  },
  {
    id: 'view.toggle-snap', label: 'Smart Guides', kind: 'toggle',
    checked: (c) => c.state.snapEnabled,
    run: (c) => { c.state.snapEnabled = !c.state.snapEnabled; },
  },
  {
    // No accelerator: Ctrl+R is reserved for browser reload (intercepting it
    // surprised users). Bind one here later if it lives behind an installed PWA.
    id: 'view.toggle-rulers', label: 'Show Rulers', kind: 'toggle',
    checked: () => { const r = document.getElementById('ruler-h'); return !!r && !r.classList.contains('hidden'); },
    run: () => {
      const ids = ['ruler-h', 'ruler-v', 'ruler-corner'];
      const hidden = document.getElementById('ruler-h')?.classList.contains('hidden') ?? false;
      for (const id of ids) document.getElementById(id)?.classList.toggle('hidden', !hidden);
    },
  },

  // ---- Color defaults (affect the style applied to NEW shapes) ----
  {
    id: 'color.default-colors', label: 'Default Fill/Stroke', kind: 'action', accel: 'D',
    run: (c) => {
      c.state.defaultStyle.fill = '#FFFFFF';
      c.state.defaultStyle.stroke = '#000000';
      c.state.fillNone = false;
      c.state.strokeNone = false;
      c.state.onChange_public();
    },
  },
  {
    id: 'color.swap-fill-stroke', label: 'Swap Fill/Stroke', kind: 'action', accel: 'Shift+X',
    run: (c) => {
      const s = c.state;
      [s.defaultStyle.fill, s.defaultStyle.stroke] = [s.defaultStyle.stroke, s.defaultStyle.fill];
      [s.fillNone, s.strokeNone] = [s.strokeNone, s.fillNone];
      s.onChange_public();
    },
  },

  // ---- Tools ----
  { id: 'tool.select', label: 'Selection Tool', kind: 'tool', accel: 'V', run: (c) => c.setTool('select') },
  { id: 'tool.direct-select', label: 'Direct Selection Tool', kind: 'tool', accel: 'A', run: (c) => c.setTool('directSelect') },
  { id: 'tool.rect', label: 'Rectangle Tool', kind: 'tool', accel: 'M', run: (c) => c.setTool('rect') },
  { id: 'tool.rounded-rect', label: 'Rounded Rectangle Tool', kind: 'tool', run: (c) => c.setTool('roundedRect') },
  { id: 'tool.ellipse', label: 'Ellipse Tool', kind: 'tool', accel: 'L', run: (c) => c.setTool('ellipse') },
  { id: 'tool.polygon', label: 'Polygon Tool', kind: 'tool', run: (c) => c.setTool('polygon') },
  { id: 'tool.star', label: 'Star Tool', kind: 'tool', run: (c) => c.setTool('star') },
  { id: 'tool.line', label: 'Line Segment Tool', kind: 'tool', accel: '\\', run: (c) => c.setTool('line') },
  { id: 'tool.polyline', label: 'Polyline Tool', kind: 'tool', run: (c) => c.setTool('polyline') },
  { id: 'tool.pen', label: 'Pen Tool', kind: 'tool', accel: 'P', run: (c) => c.setTool('path') },
  { id: 'tool.text', label: 'Type Tool', kind: 'tool', accel: 'T', run: (c) => c.setTool('text') },
  { id: 'tool.image', label: 'Image Tool', kind: 'tool', run: (c) => c.setTool('image') },
  { id: 'tool.eyedropper', label: 'Eyedropper Tool', kind: 'tool', accel: 'I', run: (c) => c.setTool('eyedropper') },
  { id: 'tool.artboard', label: 'Artboard Tool', kind: 'tool', accel: 'Shift+O', run: (c) => c.setTool('artboard') },
  { id: 'tool.hand', label: 'Hand Tool', kind: 'tool', accel: 'H', run: (c) => c.setTool('hand') },
  { id: 'tool.zoom', label: 'Zoom Tool', kind: 'tool', accel: 'Z', run: (c) => c.setTool('zoom') },
];

// ---- Lookup & dispatch ------------------------------------------------------

const byId = new Map<string, Command>(COMMANDS.map(c => [c.id, c]));

export function getCommand(id: string): Command | undefined {
  return byId.get(id);
}

export function isEnabled(cmd: Command, ctx: CommandContext): boolean {
  return cmd.enabled ? cmd.enabled(ctx) : true;
}

export function isChecked(cmd: Command, ctx: CommandContext): boolean {
  return cmd.checked ? cmd.checked(ctx) : false;
}

/** Run a command by id. No-op (with a dev warning) for unknown or disabled commands. */
export function runCommand(id: string, ctx: CommandContext): void {
  const cmd = byId.get(id);
  if (!cmd) {
    if (import.meta.env.DEV) console.warn(`[commands] unknown command: ${id}`);
    return;
  }
  if (!isEnabled(cmd, ctx)) return;
  cmd.run(ctx);
}

// ---- Accelerator parsing & matching ----------------------------------------

const IS_MAC = typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent || '');

// Punctuation/symbol keys are matched by physical `code`, because Shift mutates
// the produced character (e.g. Shift+] yields '}'), which would break `key` matching.
const PUNCT_CODE: Record<string, string> = {
  '=': 'Equal', '+': 'Equal', '-': 'Minus',
  '[': 'BracketLeft', ']': 'BracketRight',
  "'": 'Quote', '\\': 'Backslash', '/': 'Slash', ',': 'Comma', '.': 'Period',
};

interface ParsedAccel { key: string; mod: boolean; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; }

function parseAccel(accel: string): ParsedAccel {
  const parts = accel.split('+');
  const key = parts.pop() ?? '';
  return {
    key,
    mod: parts.includes('Mod'),
    ctrl: parts.includes('Ctrl'),
    alt: parts.includes('Alt'),
    shift: parts.includes('Shift'),
    meta: parts.includes('Meta'),
  };
}

function matchOne(e: KeyboardEvent, accel: string): boolean {
  const a = parseAccel(accel);
  const wantCtrl = a.ctrl || (a.mod && !IS_MAC);
  const wantMeta = a.meta || (a.mod && IS_MAC);
  if (e.ctrlKey !== wantCtrl) return false;
  if (e.metaKey !== wantMeta) return false;
  if (e.altKey !== a.alt) return false;

  // A bare letter (no modifiers) is a tool-style shortcut and matches whether
  // or not Shift is held — mirroring the original `case 'v': case 'V'` handler,
  // so a held Shift (e.g. left over from shift-click) doesn't kill tool keys.
  // Everything else requires an exact Shift match, which keeps Mod+Z (undo)
  // distinct from Mod+Shift+Z (redo).
  const isLetter = /^[A-Za-z]$/.test(a.key);
  const bareLetter = isLetter && !a.shift && !a.mod && !a.ctrl && !a.alt && !a.meta;
  if (!bareLetter && e.shiftKey !== a.shift) return false;

  // Letters: match the produced character (keyboard-layout aware), ignoring case.
  if (isLetter) return e.key.toLowerCase() === a.key.toLowerCase();
  if (/^[0-9]$/.test(a.key)) return e.code === `Digit${a.key}`;
  const code = PUNCT_CODE[a.key];
  if (code) return e.code === code;
  return e.key === a.key; // named keys: Delete, Backspace, Escape, …
}

function accelList(cmd: Command): string[] {
  if (!cmd.accel) return [];
  return Array.isArray(cmd.accel) ? cmd.accel : [cmd.accel];
}

/** First command whose accelerator matches the event, or undefined. */
export function findCommandForEvent(e: KeyboardEvent): Command | undefined {
  for (const cmd of COMMANDS) {
    for (const a of accelList(cmd)) {
      if (matchOne(e, a)) return cmd;
    }
  }
  return undefined;
}

/** Human-readable accelerator for display in menus (platform-aware). */
export function formatAccelerator(accel: string): string {
  const parts = accel.split('+');
  const key = parts.pop() ?? '';
  const mods = parts.map(m => {
    if (m === 'Mod') return IS_MAC ? '⌘' : 'Ctrl';
    if (m === 'Shift') return IS_MAC ? '⇧' : 'Shift';
    if (m === 'Alt') return IS_MAC ? '⌥' : 'Alt';
    if (m === 'Meta') return IS_MAC ? '⌘' : 'Meta';
    return m;
  });
  let keyLabel = key;
  if (key === 'Delete' || key === 'Backspace') keyLabel = 'Del';
  else if (/^[a-z]$/.test(key)) keyLabel = key.toUpperCase();
  return [...mods, keyLabel].join(IS_MAC ? '' : '+');
}

/** Display string for a command's primary accelerator (empty if it has none). */
export function primaryAccelerator(cmd: Command): string {
  const list = accelList(cmd);
  return list.length ? formatAccelerator(list[0]) : '';
}

// ---- Dev-time integrity checks ---------------------------------------------
// Catches duplicate ids and clashing accelerators the moment they're introduced,
// so the registry can't silently drift the way the old hand-wired tables did.
if (import.meta.env.DEV) {
  const ids = new Set<string>();
  const seenAccel = new Map<string, string>();
  for (const cmd of COMMANDS) {
    if (ids.has(cmd.id)) console.warn(`[commands] duplicate command id: ${cmd.id}`);
    ids.add(cmd.id);
    for (const a of accelList(cmd)) {
      const prev = seenAccel.get(a);
      if (prev) console.warn(`[commands] accelerator "${a}" bound to both ${prev} and ${cmd.id}`);
      else seenAccel.set(a, cmd.id);
    }
  }
}
