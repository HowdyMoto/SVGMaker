import type { AppState } from '../core/state';
import type { Artboard, ShapeStyle } from '../core/types';

const FORMAT_VERSION = 1;
const FILE_EXTENSION = '.svgmaker';
const MIME_TYPE = 'application/json';

/** Shape metadata stored in the project file (no DOM element references) */
interface SerializedShape {
  id: string;
  type: string;
  name: string;
  style: ShapeStyle;
  visible: boolean;
  locked: boolean;
}

/** The full project file structure */
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

/** Serialize the current state to a project file JSON string */
export function serializeProject(state: AppState): string {
  const shapes: SerializedShape[] = state.shapes.map(s => ({
    id: s.id,
    type: s.type,
    name: s.name,
    style: { ...s.style },
    visible: s.visible,
    locked: s.locked,
  }));

  const project: ProjectFile = {
    version: FORMAT_VERSION,
    app: 'SVGMaker',
    artboards: state.artboards.map(ab => ({ ...ab })),
    activeArtboardId: state.activeArtboardId,
    shapes,
    svgContent: state.getDrawingLayerSVG(),
    defaultStyle: { ...state.defaultStyle },
    fillNone: state.fillNone,
    strokeNone: state.strokeNone,
  };

  return JSON.stringify(project, null, 2);
}

/** Save the current project to a .svgmaker file download */
export function saveProject(state: AppState): void {
  const json = serializeProject(state);
  const blob = new Blob([json], { type: MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `project${FILE_EXTENSION}`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Open a file picker and load a .svgmaker project file */
export function openProject(state: AppState): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = FILE_EXTENSION + ',.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = reader.result as string;
        loadProject(state, json);
      } catch (err) {
        alert('Failed to open project: ' + (err instanceof Error ? err.message : String(err)));
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

/** Load a project from a JSON string into the app state */
export function loadProject(state: AppState, json: string): void {
  const project = JSON.parse(json) as ProjectFile;

  // Validate
  if (project.app !== 'SVGMaker') {
    throw new Error('Not a valid SVGMaker project file.');
  }
  if (!project.version || project.version > FORMAT_VERSION) {
    throw new Error(
      `Project file version ${project.version} is newer than this version of SVGMaker supports (v${FORMAT_VERSION}). Please update SVGMaker.`
    );
  }

  // Restore artboards
  if (project.artboards && project.artboards.length > 0) {
    state.artboards.length = 0;
    for (const ab of project.artboards) {
      state.artboards.push({ ...ab });
    }
    state.activeArtboardId = project.activeArtboardId ?? state.artboards[0].id;
  }

  // Restore drawing content
  state.importSVGMarkup(project.svgContent);

  // Re-apply shape metadata (names, visibility, lock) from the project file
  if (project.shapes) {
    for (const saved of project.shapes) {
      const shape = state.shapes.find(s => s.id === saved.id);
      if (!shape) continue;
      shape.name = saved.name;
      shape.style = { ...saved.style };
      shape.visible = saved.visible;
      shape.locked = saved.locked;
      if (!saved.visible) {
        (shape.element as SVGElement).style.display = 'none';
      }
      if (saved.locked) {
        shape.element.setAttribute('data-locked', 'true');
      }
    }
  }

  // Restore default style
  if (project.defaultStyle) {
    Object.assign(state.defaultStyle, project.defaultStyle);
  }
  state.fillNone = project.fillNone ?? false;
  state.strokeNone = project.strokeNone ?? false;

  state.selectedArtboardId = null;
  state.saveHistory();
  state.onChange_public();
}
