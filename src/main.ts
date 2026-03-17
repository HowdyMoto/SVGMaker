import './style.css';
import { AppState } from './core/state';
import { CanvasController } from './core/canvas';
import { SelectTool } from './tools/select';
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
import { updateSelectionOverlay } from './ui/selection-overlay';
import { setupProperties, updatePropertiesPanel } from './ui/properties';
import { updateLayersPanel, setupLayerButtons } from './ui/layers';
import { exportSVG } from './ui/export';
import { setupMenus } from './ui/menus';
import { drawRulers } from './ui/rulers';
import { setupSwatches } from './ui/swatches';
import { setupColorPanel } from './ui/color-panel';
import { setupAlign } from './ui/align';
import { renderArtboards } from './ui/artboard-renderer';
import { updateArtboardsPanel, setupArtboardButtons } from './ui/artboards-panel';
import { showExportDialog } from './ui/export-dialog';
import { saveProject, openProject } from './ui/project-file';
import type { Tool } from './tools/base';
import type { ToolName } from './core/types';

// DOM elements
const svgCanvas = document.getElementById('svg-canvas') as unknown as SVGSVGElement;
const drawingLayer = document.getElementById('drawing-layer') as unknown as SVGGElement;
const selectionLayer = document.getElementById('selection-layer') as unknown as SVGGElement;

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
};

// Tools
const tools: Record<ToolName, Tool> = {
  select: new SelectTool(state, canvas, svgCanvas),
  directSelect: new SelectTool(state, canvas, svgCanvas),
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
};

let activeTool: Tool = tools.select;

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
  updatePropertiesPanel(state);
  updateLayersPanel(state);
  updateArtboardsPanel(state);
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
  if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;

  if (e.ctrlKey || e.metaKey) {
    if (e.altKey && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      showExportDialog(state);
      return;
    }
    switch (e.key) {
      case 'z': e.preventDefault(); if (e.shiftKey) state.redo(); else state.undo(); break;
      case 'y': e.preventDefault(); state.redo(); break;
      case 'd': e.preventDefault(); if (state.selectedShapeId) state.duplicateShape(state.selectedShapeId); break;
      case 's': e.preventDefault(); if (e.shiftKey) exportSVG(state); else saveProject(state); break;
      case 'e': e.preventDefault(); exportSVG(state); break;
      case 'o': e.preventDefault(); openProject(state); break;
      case '0': e.preventDefault(); canvas.fitToWindow(getArtboardsBounds()); break;
      case '1': e.preventDefault(); canvas.setZoom(1); break;
      case '=': case '+': e.preventDefault(); canvas.setZoom(canvas.getZoom() * 1.25); break;
      case '-': e.preventDefault(); canvas.setZoom(canvas.getZoom() / 1.25); break;
    }
    return;
  }

  // Shift+O for artboard tool
  if (e.key === 'O' && e.shiftKey) {
    setTool('artboard');
    return;
  }

  switch (e.key) {
    case 'v': case 'V': setTool('select'); break;
    case 'a': case 'A': setTool('directSelect'); break;
    case 'm': case 'M': setTool('rect'); break;
    case 'l': case 'L': setTool('ellipse'); break;
    case 'p': case 'P': setTool('path'); break;
    case 't': case 'T': setTool('text'); break;
    case 'h': case 'H': setTool('hand'); break;
    case 'z': case 'Z': setTool('zoom'); break;
    case 'i': case 'I': setTool('eyedropper'); break;
    case '\\': setTool('line'); break;
    case 'Delete': case 'Backspace':
      if (state.selectedShapeId) state.removeShape(state.selectedShapeId);
      break;
    case ' ':
      e.preventDefault();
      if (!spaceDown) {
        spaceDown = true;
        prevToolBeforeSpace = state.currentTool;
        setTool('hand');
      }
      break;
    case 'd': case 'D':
      state.defaultStyle.fill = '#FFFFFF';
      state.defaultStyle.stroke = '#000000';
      state.fillNone = false;
      state.strokeNone = false;
      state.onChange_public();
      break;
    default:
      if (activeTool.onKeyDown) activeTool.onKeyDown(e);
  }

  if (e.key === 'X' && e.shiftKey) {
    const tmpFill = state.defaultStyle.fill;
    state.defaultStyle.fill = state.defaultStyle.stroke;
    state.defaultStyle.stroke = tmpFill;
    const tmpNone = state.fillNone;
    state.fillNone = state.strokeNone;
    state.strokeNone = tmpNone;
    state.onChange_public();
  }
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

// Toolbar fill/stroke swap & default
document.getElementById('tb-swap')?.addEventListener('click', () => {
  const tmpFill = state.defaultStyle.fill;
  state.defaultStyle.fill = state.defaultStyle.stroke;
  state.defaultStyle.stroke = tmpFill;
  const tmpNone = state.fillNone;
  state.fillNone = state.strokeNone;
  state.strokeNone = tmpNone;
  state.onChange_public();
});

document.getElementById('tb-default')?.addEventListener('click', () => {
  state.defaultStyle.fill = '#FFFFFF';
  state.defaultStyle.stroke = '#000000';
  state.fillNone = false;
  state.strokeNone = false;
  state.onChange_public();
});

// Rulers update on view change
canvas.setOnViewChange(() => {
  drawRulers(canvas);
});

// Zoom-fit button uses artboard bounds
document.getElementById('btn-zoom-fit')?.addEventListener('click', () => {
  canvas.fitToWindow(getArtboardsBounds());
});

// Setup
setupMenus(state);
setupProperties(state);
setupLayerButtons(state);
setupArtboardButtons(state);
setupSwatches(state);
setupColorPanel(state);
setupAlign(state);

// Initial render
const initBounds = getArtboardsBounds();
canvas.initSize(initBounds);
renderArtboards(state, svgCanvas);
updateArtboardsPanel(state);
drawRulers(canvas);

svgCanvas.setAttribute('data-tool', 'select');

window.addEventListener('resize', () => {
  canvas.initSize(getArtboardsBounds());
  drawRulers(canvas);
});
