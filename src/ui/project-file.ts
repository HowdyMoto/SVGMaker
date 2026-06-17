import type { AppState } from '../core/state';
import type { Artboard, ShapeStyle } from '../core/types';
import type { FilePickerType } from '../core/file-access';
import {
  supportsFileSystemAccess,
  openFilePicker,
  saveFilePicker,
  writeHandle,
  readHandle,
  downloadFile,
} from '../core/file-access';
import { rememberRecentFile } from './recent-files';
import { SVG_NS_DECLS, ensureSvgNamespaces } from '../core/svg-ns';

const FORMAT_VERSION = 1;
const SVG_EXTENSION = '.svg';
const SVG_MIME = 'image/svg+xml';
const LEGACY_EXTENSION = '.svgmaker';

const PICKER_TYPES: FilePickerType[] = [
  { description: 'SVG Image', accept: { [SVG_MIME]: [SVG_EXTENSION] } },
];

/** Handle of the file currently being edited, so Save can write in place. */
let currentHandle: FileSystemFileHandle | null = null;

/** Update the title bar / document title with the current file name. */
function setProjectName(name: string | null): void {
  const label = document.getElementById('project-name');
  const display = name ?? 'Untitled';
  if (label) label.textContent = display;
  document.title = `${display} — SVGMaker`;
}

/** Reset to a fresh, unsaved document (called when starting a new file). */
export function resetProjectFile(): void {
  currentHandle = null;
  setProjectName(null);
}

// ---------------------------------------------------------------------------
// Editor metadata embedded inside the saved SVG (ignored by other tools).
// ---------------------------------------------------------------------------

interface SerializedShape {
  id: string;
  type: string;
  name: string;
  style: ShapeStyle;
  visible: boolean;
  locked: boolean;
}

interface DocMeta {
  app: 'SVGMaker';
  version: number;
  artboards: Artboard[];
  activeArtboardId: string | null;
  shapes: SerializedShape[];
  defaultStyle: ShapeStyle;
  fillNone: boolean;
  strokeNone: boolean;
}

function buildMeta(state: AppState): DocMeta {
  return {
    app: 'SVGMaker',
    version: FORMAT_VERSION,
    artboards: state.artboards.map(ab => ({ ...ab })),
    activeArtboardId: state.activeArtboardId,
    shapes: state.shapes.map(s => ({
      id: s.id, type: s.type, name: s.name,
      style: { ...s.style }, visible: s.visible, locked: s.locked,
    })),
    defaultStyle: { ...state.defaultStyle },
    fillNone: state.fillNone,
    strokeNone: state.strokeNone,
  };
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Bounding box that encloses every artboard, used as the SVG viewport. */
function unionArtboardBounds(state: AppState): { x: number; y: number; w: number; h: number } {
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

/**
 * Serialize the document to a standard SVG. Editor-only state (artboards,
 * lock flags, default styles) is stored in a <metadata> block so the file
 * round-trips losslessly while remaining a valid SVG that renders anywhere.
 */
export function serializeDocumentSVG(state: AppState): string {
  const b = unionArtboardBounds(state);
  const metaJson = xmlEscape(JSON.stringify(buildMeta(state)));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" ${SVG_NS_DECLS} viewBox="${b.x} ${b.y} ${b.w} ${b.h}" width="${b.w}" height="${b.h}">
<metadata class="svgmaker-state">${metaJson}</metadata>
${state.getDefsBlock()}<g class="svgmaker-doc">${state.getDrawingLayerSVG()}</g>
</svg>`;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Re-apply names/visibility/lock/style that don't fully live in the markup. */
function applyShapeMeta(state: AppState, shapes: SerializedShape[]): void {
  for (const saved of shapes) {
    const shape = state.findShapeById(saved.id);
    if (!shape) continue;
    shape.name = saved.name;
    shape.style = { ...saved.style };
    shape.visible = saved.visible;
    shape.locked = saved.locked;
    if (!saved.visible) (shape.element as SVGElement).style.display = 'none';
    if (saved.locked) shape.element.setAttribute('data-locked', 'true');
  }
}

/** Load a document from an SVG string (ours, with metadata, or a foreign SVG). */
export function loadDocumentSVG(state: AppState, svgString: string): void {
  const doc = new DOMParser().parseFromString(ensureSvgNamespaces(svgString), 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) throw new Error('File is not a valid SVG.');

  // Look for our embedded editor metadata.
  let meta: DocMeta | null = null;
  const metaEl = svgEl.querySelector('metadata.svgmaker-state') ?? svgEl.querySelector('metadata');
  if (metaEl?.textContent) {
    try {
      const parsed = JSON.parse(metaEl.textContent.trim());
      if (parsed && parsed.app === 'SVGMaker') meta = parsed as DocMeta;
    } catch { /* not our metadata — treat as a foreign SVG */ }
  }

  if (meta) {
    // ---- Our document: restore everything ----
    if (meta.version > FORMAT_VERSION) {
      throw new Error(`This file was made with a newer SVGMaker (v${meta.version}). Please update.`);
    }

    if (meta.artboards?.length) {
      state.artboards.length = 0;
      for (const ab of meta.artboards) state.artboards.push({ ...ab });
      state.activeArtboardId = meta.activeArtboardId ?? state.artboards[0].id;
    }

    state.clearDefs();
    state.importDefsFrom(svgEl);

    // Drawing content lives inside <g class="svgmaker-doc">.
    const body = svgEl.querySelector('g.svgmaker-doc');
    const serializer = new XMLSerializer();
    let markup = '';
    if (body) {
      for (const child of Array.from(body.children)) markup += serializer.serializeToString(child);
    }
    state.importSVGMarkup(markup);

    if (meta.shapes) applyShapeMeta(state, meta.shapes);
    if (meta.defaultStyle) Object.assign(state.defaultStyle, meta.defaultStyle);
    state.fillNone = meta.fillNone ?? false;
    state.strokeNone = meta.strokeNone ?? false;
  } else {
    // ---- Foreign SVG: import shapes and wrap them in a single artboard ----
    state.clearDefs();
    state.importSVGContent(svgString);

    const vb = svgEl.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
    const w = parseFloat(svgEl.getAttribute('width') ?? '') || vb?.[2] || 960;
    const h = parseFloat(svgEl.getAttribute('height') ?? '') || vb?.[3] || 540;
    const x = vb?.[0] || 0;
    const y = vb?.[1] || 0;
    state.artboards.length = 0;
    state.artboards.push({ id: state.nextArtboardId(), x, y, width: w, height: h, name: 'Artboard 1' });
    state.activeArtboardId = state.artboards[0].id;
  }

  state.selectedArtboardId = null;
  state.saveHistory();
  state.onChange_public();
}

/** Dispatch on file contents: legacy .svgmaker JSON vs. SVG. */
export function loadDocumentString(state: AppState, text: string): void {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    loadProject(state, text); // legacy .svgmaker project
  } else {
    loadDocumentSVG(state, text);
  }
}

// ---------------------------------------------------------------------------
// Save / Open (File System Access with download fallback)
// ---------------------------------------------------------------------------

export async function saveProject(state: AppState): Promise<void> {
  const svg = serializeDocumentSVG(state);

  if (currentHandle) {
    try {
      await writeHandle(currentHandle, svg);
      await rememberRecentFile(currentHandle);
      return;
    } catch (err) {
      console.warn('Direct save failed, prompting for a new location:', err);
      currentHandle = null;
    }
  }

  await saveProjectAs(state);
}

export async function saveProjectAs(state: AppState): Promise<void> {
  const svg = serializeDocumentSVG(state);
  const base = (document.getElementById('project-name')?.textContent || 'drawing')
    .replace(/\.svg$/i, '');

  if (supportsFileSystemAccess()) {
    try {
      const handle = await saveFilePicker(`${base}${SVG_EXTENSION}`, PICKER_TYPES);
      if (!handle) return; // cancelled
      await writeHandle(handle, svg);
      currentHandle = handle;
      setProjectName(handle.name);
      await rememberRecentFile(handle);
      return;
    } catch (err) {
      alert('Failed to save: ' + (err instanceof Error ? err.message : String(err)));
      return;
    }
  }

  downloadFile(`${base}${SVG_EXTENSION}`, svg, SVG_MIME);
}

export async function openProject(state: AppState): Promise<void> {
  if (supportsFileSystemAccess()) {
    try {
      const handle = await openFilePicker([
        { description: 'SVG / SVGMaker', accept: { [SVG_MIME]: [SVG_EXTENSION], 'application/json': [LEGACY_EXTENSION] } },
      ]);
      if (!handle) return; // cancelled
      await openHandle(state, handle);
    } catch (err) {
      alert('Failed to open: ' + (err instanceof Error ? err.message : String(err)));
    }
    return;
  }

  // Fallback: hidden file input.
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = `${SVG_EXTENSION},${LEGACY_EXTENSION},.json`;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        loadDocumentString(state, reader.result as string);
        currentHandle = null; // can't write back without FS Access
        setProjectName(file.name);
      } catch (err) {
        alert('Failed to open: ' + (err instanceof Error ? err.message : String(err)));
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

/** Load document text that has no writable handle (e.g. a dropped file). */
export function openTextWithoutHandle(state: AppState, text: string, name: string): void {
  loadDocumentString(state, text);
  currentHandle = null;
  setProjectName(name);
}

/** Open a document directly from a handle (used by Open and Recent Files). */
export async function openHandle(state: AppState, handle: FileSystemFileHandle): Promise<void> {
  const text = await readHandle(handle);
  loadDocumentString(state, text);
  currentHandle = handle;
  setProjectName(handle.name);
  await rememberRecentFile(handle);
}

// ---------------------------------------------------------------------------
// Legacy .svgmaker (JSON) loading — open-only, for backward compatibility.
// ---------------------------------------------------------------------------

interface ProjectFile {
  version: number;
  app: 'SVGMaker';
  artboards: Artboard[];
  activeArtboardId: string | null;
  shapes: SerializedShape[];
  svgContent: string;
  defaultStyle: ShapeStyle;
  fillNone: boolean;
  strokeNone: boolean;
}

export function loadProject(state: AppState, json: string): void {
  const project = JSON.parse(json) as ProjectFile;
  if (project.app !== 'SVGMaker') throw new Error('Not a valid SVGMaker file.');
  if (!project.version || project.version > FORMAT_VERSION) {
    throw new Error(`File version ${project.version} is newer than this version of SVGMaker supports.`);
  }

  if (project.artboards?.length) {
    state.artboards.length = 0;
    for (const ab of project.artboards) state.artboards.push({ ...ab });
    state.activeArtboardId = project.activeArtboardId ?? state.artboards[0].id;
  }

  state.importSVGMarkup(project.svgContent);
  if (project.shapes) applyShapeMeta(state, project.shapes);
  if (project.defaultStyle) Object.assign(state.defaultStyle, project.defaultStyle);
  state.fillNone = project.fillNone ?? false;
  state.strokeNone = project.strokeNone ?? false;

  state.selectedArtboardId = null;
  state.saveHistory();
  state.onChange_public();
}
