import './style.css';
import { AppState } from './core/state';
import { CanvasController } from './core/canvas';
import { SelectTool } from './tools/select';
import { NodeEditTool } from './tools/node-edit';
import { RectTool } from './tools/rect';
import { RoundedRectTool } from './tools/rounded-rect';
import { EllipseTool } from './tools/ellipse';
import { LineTool } from './tools/line';
import { PolylineTool } from './tools/polyline';
import { PathTool } from './tools/path';
import { TextTool } from './tools/text';
import { HandTool } from './tools/hand';
import { ZoomTool } from './tools/zoom-tool';
import { EyedropperTool } from './tools/eyedropper';
import { StarTool } from './tools/star';
import { PolygonShapeTool } from './tools/polygon-tool';
import { ArtboardTool } from './tools/artboard-tool';
import { ImageTool } from './tools/image';
import { updateSelectionOverlay } from './ui/selection-overlay';
import { renderNodeOverlay } from './ui/node-overlay';
import { setupProperties, updatePropertiesPanel } from './ui/properties';
import { updateLayersPanel, setupLayerButtons } from './ui/layers';
import { setupMenus } from './ui/menus';
import { drawRulers } from './ui/rulers';
import { setupColorPicker } from './ui/color-picker';
import { setupAlign } from './ui/align';
import { renderArtboards } from './ui/artboard-renderer';
import { updateArtboardsPanel, setupArtboardButtons, setupArtboardProps } from './ui/artboards-panel';
import { updateSymbolsPanel, setupSymbolButtons } from './ui/symbols-panel';
import { openHandle, openTextWithoutHandle, confirmDiscard } from './ui/project-file';
import { setupRecentFilesMenu } from './ui/recent-files';
import type { Tool } from './tools/base';
import type { ToolName } from './core/types';
import type { CommandContext } from './commands';
import { runCommand, findCommandForEvent, isEnabled } from './commands';

// DOM elements
const svgCanvas = document.getElementById('svg-canvas') as unknown as SVGSVGElement;
const drawingLayer = document.getElementById('drawing-layer') as unknown as SVGGElement;
const selectionLayer = document.getElementById('selection-layer') as unknown as SVGGElement;
const guidesLayer = document.getElementById('guides-layer') as unknown as SVGGElement;

// State & canvas
const state = new AppState(drawingLayer, onStateChange);
const canvas = new CanvasController(svgCanvas);

// Tool label map
const toolLabels: Record<ToolName, string> = {
  select: 'Selection Tool',
  directSelect: 'Direct Selection Tool',
  rect: 'Rectangle Tool',
  roundedRect: 'Rounded Rectangle Tool',
  ellipse: 'Ellipse Tool',
  line: 'Line Segment Tool',
  polyline: 'Polyline Tool',
  path: 'Pen Tool',
  text: 'Type Tool',
  hand: 'Hand Tool',
  zoom: 'Zoom Tool',
  eyedropper: 'Eyedropper Tool',
  star: 'Star Tool',
  polygon: 'Polygon Tool',
  artboard: 'Artboard Tool',
  image: 'Image Tool',
};

// Tools
const tools: Record<ToolName, Tool> = {
  select: new SelectTool(state, canvas, svgCanvas),
  directSelect: new NodeEditTool(state, canvas, svgCanvas),
  rect: new RectTool(state, canvas, svgCanvas),
  roundedRect: new RoundedRectTool(state, canvas, svgCanvas),
  ellipse: new EllipseTool(state, canvas, svgCanvas),
  line: new LineTool(state, canvas, svgCanvas),
  polyline: new PolylineTool(state, canvas, svgCanvas),
  path: new PathTool(state, canvas, svgCanvas),
  text: new TextTool(state, canvas, svgCanvas),
  hand: new HandTool(state, canvas, svgCanvas),
  zoom: new ZoomTool(state, canvas, svgCanvas),
  eyedropper: new EyedropperTool(state, canvas, svgCanvas),
  star: new StarTool(state, canvas, svgCanvas),
  polygon: new PolygonShapeTool(state, canvas, svgCanvas),
  artboard: new ArtboardTool(state, canvas, svgCanvas),
  image: new ImageTool(state, canvas, svgCanvas),
};

let activeTool: Tool = tools.select;

// Shared context handed to every command (menus, keyboard, panel buttons).
// `setTool` and `getArtboardsBounds` are hoisted function declarations.
const commandCtx: CommandContext = { state, canvas, setTool, getArtboardsBounds };

function getArtboardsBounds(): { x: number; y: number; w: number; h: number } {
  if (state.artboards.length === 0) return { x: 0, y: 0, w: 960, h: 540 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ab of state.artboards) {
    minX = Math.min(minX, ab.x);
    minY = Math.min(minY, ab.y);
    maxX = Math.max(maxX, ab.x + ab.width);
    maxY = Math.max(maxY, ab.y + ab.height);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function onStateChange(): void {
  renderArtboards(state, svgCanvas);
  updateSelectionOverlay(state, selectionLayer);
  renderNodeOverlay(state, guidesLayer);
  updatePropertiesPanel(state);
  updateLayersPanel(state);
  updateArtboardsPanel(state);
  updateSymbolsPanel(state);
}

function setTool(toolName: ToolName): void {
  if (activeTool.deactivate) activeTool.deactivate();
  state.currentTool = toolName;
  activeTool = tools[toolName];
  if (activeTool.activate) activeTool.activate();

  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tool') === toolName);
  });

  svgCanvas.setAttribute('data-tool', toolName);
  document.getElementById('tool-label')!.textContent = toolLabels[toolName] || toolName;
}

// Mouse events on canvas
let isMouseDown = false;

svgCanvas.addEventListener('mousedown', (e: MouseEvent) => {
  if (e.button === 1) {
    e.preventDefault();
    canvas.startPan(e.clientX, e.clientY);
    return;
  }
  if (e.button !== 0) return;
  // Interacting with the canvas makes the Layers list the delete target.
  if (state.currentTool !== 'artboard') state.activePanel = 'layers';
  isMouseDown = true;
  const pt = canvas.screenToSVG(e.clientX, e.clientY);
  activeTool.onMouseDown(pt, e);
});

svgCanvas.addEventListener('mousemove', (e: MouseEvent) => {
  const pt = canvas.screenToSVG(e.clientX, e.clientY);
  activeTool.onMouseMove(pt, e);
});

window.addEventListener('mouseup', (e: MouseEvent) => {
  if (canvas.panning) {
    canvas.endPan();
    return;
  }
  if (!isMouseDown) return;
  isMouseDown = false;
  const pt = canvas.screenToSVG(e.clientX, e.clientY);
  activeTool.onMouseUp(pt, e);
});

// Toolbar clicks
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    const toolName = btn.getAttribute('data-tool') as ToolName;
    setTool(toolName);
  });
});

// Panel collapse
document.querySelectorAll('.panel-header').forEach(header => {
  header.addEventListener('click', (e) => {
    if ((e.target as Element).closest('.panel-collapse')) {
      const panel = header.closest('.panel')!;
      panel.classList.toggle('collapsed');
    }
  });
});

// Keyboard shortcuts
let spaceDown = false;
let prevToolBeforeSpace: ToolName | null = null;

window.addEventListener('keydown', (e: KeyboardEvent) => {
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

  // Node editing: Delete/Backspace removes the selected anchor points, not the
  // whole path — so it can't go through the registry's edit.delete command.
  if ((e.key === 'Delete' || e.key === 'Backspace') &&
      state.editingPathId && state.pathEdit && state.pathEdit.selected.size > 0) {
    e.preventDefault();
    if (activeTool.onKeyDown) activeTool.onKeyDown(e);
    return;
  }

  // Spring-loaded pan: holding Space temporarily switches to the Hand tool and
  // restores the previous tool on keyup (handled below). Stateful, so bespoke.
  if (e.key === ' ') {
    e.preventDefault();
    if (!spaceDown) {
      spaceDown = true;
      prevToolBeforeSpace = state.currentTool;
      setTool('hand');
    }
    return;
  }

  // Everything else dispatches through the command registry — the single
  // source of truth shared with the menus and panel buttons. Only swallow the
  // browser default when we actually run something (a disabled command lets the
  // native key through, e.g. Backspace stays harmless with nothing selected).
  const cmd = findCommandForEvent(e);
  if (cmd) {
    if (isEnabled(cmd, commandCtx)) {
      e.preventDefault();
      cmd.run(commandCtx);
    }
    return;
  }

  // Unhandled plain keys fall through to the active tool (e.g. pen Enter/Escape).
  if (!e.ctrlKey && !e.metaKey && activeTool.onKeyDown) activeTool.onKeyDown(e);
});

window.addEventListener('keyup', (e: KeyboardEvent) => {
  if (e.key === ' ') {
    spaceDown = false;
    if (prevToolBeforeSpace) {
      setTool(prevToolBeforeSpace);
      prevToolBeforeSpace = null;
    }
  }
});

// Toolbar fill/stroke swap & default — share the registry commands.
document.getElementById('tb-swap')?.addEventListener('click', () => runCommand('color.swap-fill-stroke', commandCtx));
document.getElementById('tb-default')?.addEventListener('click', () => runCommand('color.default-colors', commandCtx));

// Rulers update on view change
canvas.setOnViewChange(() => {
  drawRulers(canvas);
});

// Zoom-fit button uses artboard bounds
document.getElementById('btn-zoom-fit')?.addEventListener('click', () => {
  canvas.fitToWindow(getArtboardsBounds());
});

// Setup
setupMenus(commandCtx);
setupProperties(state);
setupLayerButtons(commandCtx);
setupArtboardButtons(state);
setupArtboardProps(state);
setupColorPicker(state);
setupAlign(state);
setupSymbolButtons(commandCtx);
setupRecentFilesMenu(state);

// Initial render
const initBounds = getArtboardsBounds();
canvas.initSize(initBounds);
renderArtboards(state, svgCanvas);
updateArtboardsPanel(state);
drawRulers(canvas);

svgCanvas.setAttribute('data-tool', 'select');

// Drag-and-drop image support
const canvasArea = document.getElementById('canvas-area')!;
canvasArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer!.dropEffect = 'copy';
});
canvasArea.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;

  const file = files[0];
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  const isLegacy = /\.svgmaker$/i.test(file.name);

  // Dropping a document (SVG or legacy project) opens it for editing.
  if (isSvg || isLegacy) {
    if (!confirmDiscard(state)) return;

    // Prefer a writable handle so the dropped file can be saved in place.
    const item = e.dataTransfer?.items?.[0] as (DataTransferItem & {
      getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
    }) | undefined;
    if (item?.getAsFileSystemHandle) {
      item.getAsFileSystemHandle().then((handle) => {
        if (handle && handle.kind === 'file') {
          openHandle(state, handle as FileSystemFileHandle);
        } else {
          readDroppedDoc(file);
        }
      }).catch(() => readDroppedDoc(file));
    } else {
      readDroppedDoc(file);
    }
    return;
  }

  // Other image types are embedded as <image>.
  for (let i = 0; i < files.length; i++) {
    if (files[i].type.startsWith('image/')) {
      (tools.image as ImageTool).loadImageFile(files[i]);
    }
  }
});

function readDroppedDoc(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      openTextWithoutHandle(state, reader.result as string, file.name);
    } catch (err) {
      alert('Failed to open: ' + (err instanceof Error ? err.message : String(err)));
    }
  };
  reader.readAsText(file);
}

window.addEventListener('resize', () => {
  canvas.initSize(getArtboardsBounds());
  drawRulers(canvas);
});

// Warn before closing/reloading the tab with unsaved changes.
window.addEventListener('beforeunload', (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Register the service worker for offline/PWA support. Production only, so it
// never caches modules during dev (which would break HMR).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ });
  });
}

// File Handling API: when the OS opens an .svg/.svgmaker with the installed
// PWA, it hands us file handles here. Route them through the normal open path.
const launchQueue = (window as unknown as {
  launchQueue?: { setConsumer: (cb: (params: { files: FileSystemFileHandle[] }) => void) => void };
}).launchQueue;
if (launchQueue) {
  launchQueue.setConsumer((params) => {
    const handle = params.files?.[0];
    if (handle && confirmDiscard(state)) {
      openHandle(state, handle).catch((err) => {
        alert('Failed to open file: ' + (err instanceof Error ? err.message : String(err)));
      });
    }
  });
}
