import type { ToolName, ShapeData, HistoryEntry, ShapeStyle, Artboard } from './types';

export class AppState {
  currentTool: ToolName = 'select';
  shapes: ShapeData[] = [];
  selectedShapeId: string | null = null;
  private idCounter = 0;
  private abCounter = 0;
  private history: HistoryEntry[] = [];
  private historyIndex = -1;
  private maxHistory = 100;
  private drawingLayer: SVGGElement;
  private onChangeCallback: () => void;

  artboards: Artboard[] = [];
  activeArtboardId: string | null = null;
  selectedArtboardId: string | null = null; // used by artboard tool

  defaultStyle: ShapeStyle = {
    fill: '#FFFFFF',
    stroke: '#000000',
    strokeWidth: 1,
    opacity: 1,
    fontSize: 24,
    fontFamily: 'Arial',
    fontWeight: 'normal',
    fontStyle: 'normal',
    strokeLinecap: 'butt',
    strokeLinejoin: 'miter',
    rx: 0,
  };

  fillNone = false;
  strokeNone = false;

  constructor(drawingLayer: SVGGElement, onChange: () => void) {
    this.drawingLayer = drawingLayer;
    this.onChangeCallback = onChange;
    // Create default artboard
    this.artboards.push({
      id: this.nextArtboardId(),
      x: 0, y: 0,
      width: 960, height: 540,
      name: 'Artboard 1',
    });
    this.activeArtboardId = this.artboards[0].id;
    this.saveHistory();
  }

  // Keep the legacy getter for backward compat with align, export, etc.
  get artboard(): Artboard {
    return this.getActiveArtboard();
  }

  getActiveArtboard(): Artboard {
    return this.artboards.find(a => a.id === this.activeArtboardId) ?? this.artboards[0];
  }

  getArtboardById(id: string): Artboard | undefined {
    return this.artboards.find(a => a.id === id);
  }

  nextArtboardId(): string {
    return `ab-${++this.abCounter}`;
  }

  addArtboard(ab: Artboard): void {
    this.artboards.push(ab);
    this.activeArtboardId = ab.id;
    this.saveHistory();
    this.onChangeCallback();
  }

  removeArtboard(id: string): void {
    if (this.artboards.length <= 1) return; // Must keep at least one
    const idx = this.artboards.findIndex(a => a.id === id);
    if (idx === -1) return;
    this.artboards.splice(idx, 1);
    if (this.activeArtboardId === id) {
      this.activeArtboardId = this.artboards[0].id;
    }
    if (this.selectedArtboardId === id) {
      this.selectedArtboardId = null;
    }
    this.saveHistory();
    this.onChangeCallback();
  }

  updateArtboard(id: string, updates: Partial<Omit<Artboard, 'id'>>): void {
    const ab = this.artboards.find(a => a.id === id);
    if (!ab) return;
    Object.assign(ab, updates);
    this.onChangeCallback();
  }

  setActiveArtboard(id: string): void {
    this.activeArtboardId = id;
    this.onChangeCallback();
  }

  /** Get all shapes whose center falls within the given artboard */
  getShapesOnArtboard(abId: string): ShapeData[] {
    const ab = this.getArtboardById(abId);
    if (!ab) return [];
    return this.shapes.filter(shape => {
      try {
        const bbox = (shape.element as unknown as SVGGraphicsElement).getBBox();
        const cx = bbox.x + bbox.width / 2;
        const cy = bbox.y + bbox.height / 2;
        return cx >= ab.x && cx <= ab.x + ab.width && cy >= ab.y && cy <= ab.y + ab.height;
      } catch {
        return false;
      }
    });
  }

  onChange_public(): void {
    this.onChangeCallback();
  }

  nextId(): string {
    return `shape-${++this.idCounter}`;
  }

  addShape(shape: ShapeData): void {
    this.shapes.push(shape);
    this.drawingLayer.appendChild(shape.element);
    this.selectedShapeId = shape.id;
    this.saveHistory();
    this.onChangeCallback();
  }

  removeShape(id: string): void {
    const idx = this.shapes.findIndex(s => s.id === id);
    if (idx === -1) return;
    const shape = this.shapes[idx];
    shape.element.remove();
    this.shapes.splice(idx, 1);
    if (this.selectedShapeId === id) {
      this.selectedShapeId = null;
    }
    this.saveHistory();
    this.onChangeCallback();
  }

  getSelectedShape(): ShapeData | null {
    if (!this.selectedShapeId) return null;
    return this.shapes.find(s => s.id === this.selectedShapeId) ?? null;
  }

  selectShape(id: string | null): void {
    this.selectedShapeId = id;
    this.onChangeCallback();
  }

  toggleVisibility(id: string): void {
    const shape = this.shapes.find(s => s.id === id);
    if (!shape) return;
    shape.visible = !shape.visible;
    (shape.element as SVGElement).style.display = shape.visible ? '' : 'none';
    this.saveHistory();
    this.onChangeCallback();
  }

  toggleLock(id: string): void {
    const shape = this.shapes.find(s => s.id === id);
    if (!shape) return;
    shape.locked = !shape.locked;
    this.onChangeCallback();
  }

  moveShapeUp(id: string): void {
    const idx = this.shapes.findIndex(s => s.id === id);
    if (idx < this.shapes.length - 1) {
      const shape = this.shapes[idx];
      const nextShape = this.shapes[idx + 1];
      this.shapes[idx] = nextShape;
      this.shapes[idx + 1] = shape;
      this.drawingLayer.insertBefore(nextShape.element, shape.element);
      this.saveHistory();
      this.onChangeCallback();
    }
  }

  moveShapeDown(id: string): void {
    const idx = this.shapes.findIndex(s => s.id === id);
    if (idx > 0) {
      const shape = this.shapes[idx];
      const prevShape = this.shapes[idx - 1];
      this.shapes[idx] = prevShape;
      this.shapes[idx - 1] = shape;
      this.drawingLayer.insertBefore(shape.element, prevShape.element);
      this.saveHistory();
      this.onChangeCallback();
    }
  }

  duplicateShape(id: string): void {
    const shape = this.shapes.find(s => s.id === id);
    if (!shape) return;
    const newEl = shape.element.cloneNode(true) as SVGElement;
    const newId = this.nextId();
    newEl.id = newId;
    const bbox = (shape.element as unknown as SVGGraphicsElement).getBBox();
    const tag = newEl.tagName.toLowerCase();
    if (tag === 'rect' || tag === 'text') {
      newEl.setAttribute('x', String(bbox.x + 10));
      newEl.setAttribute('y', String(bbox.y + 10));
    } else if (tag === 'ellipse') {
      newEl.setAttribute('cx', String(parseFloat(newEl.getAttribute('cx') ?? '0') + 10));
      newEl.setAttribute('cy', String(parseFloat(newEl.getAttribute('cy') ?? '0') + 10));
    }
    const name = `${shape.type} ${newId.replace('shape-', '#')}`;
    newEl.setAttribute('data-name', name);
    this.addShape({
      id: newId, type: shape.type, element: newEl, name,
      style: { ...shape.style }, visible: true, locked: false,
    });
  }

  saveHistory(): void {
    const entry: HistoryEntry = {
      svgContent: this.drawingLayer.innerHTML,
      selectedId: this.selectedShapeId,
      artboardsJson: JSON.stringify(this.artboards),
    };
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    this.historyIndex = this.history.length - 1;
  }

  undo(): boolean {
    if (this.historyIndex <= 0) return false;
    this.historyIndex--;
    this.restoreHistory(this.history[this.historyIndex]);
    return true;
  }

  redo(): boolean {
    if (this.historyIndex >= this.history.length - 1) return false;
    this.historyIndex++;
    this.restoreHistory(this.history[this.historyIndex]);
    return true;
  }

  get canUndo(): boolean { return this.historyIndex > 0; }
  get canRedo(): boolean { return this.historyIndex < this.history.length - 1; }

  private restoreHistory(entry: HistoryEntry): void {
    this.drawingLayer.innerHTML = entry.svgContent;
    this.rebuildShapesFromDOM();
    this.selectedShapeId = entry.selectedId;
    try {
      this.artboards = JSON.parse(entry.artboardsJson);
      // Restore abCounter
      let maxAb = 0;
      for (const ab of this.artboards) {
        const m = ab.id.match(/ab-(\d+)/);
        if (m) maxAb = Math.max(maxAb, parseInt(m[1]));
      }
      this.abCounter = Math.max(this.abCounter, maxAb);
      if (!this.artboards.find(a => a.id === this.activeArtboardId)) {
        this.activeArtboardId = this.artboards[0]?.id ?? null;
      }
    } catch { /* keep current artboards */ }
    this.onChangeCallback();
  }

  rebuildShapesFromDOM(): void {
    this.shapes = [];
    const elements = this.drawingLayer.children;
    let maxId = 0;
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i] as SVGElement;
      const id = el.id;
      if (!id) continue;
      const numMatch = id.match(/shape-(\d+)/);
      if (numMatch) {
        const num = parseInt(numMatch[1]);
        if (num > maxId) maxId = num;
      }
      const type = this.detectType(el);
      if (!type) continue;
      this.shapes.push({
        id, type, element: el,
        name: el.getAttribute('data-name') || `${type} ${id.replace('shape-', '#')}`,
        style: this.readStyle(el, type),
        visible: el.style.display !== 'none',
        locked: el.getAttribute('data-locked') === 'true',
      });
    }
    this.idCounter = Math.max(this.idCounter, maxId);
  }

  private detectType(el: SVGElement): ShapeData['type'] | null {
    const tag = el.tagName.toLowerCase();
    if (tag === 'rect') return 'rect';
    if (tag === 'ellipse') return 'ellipse';
    if (tag === 'line') return 'line';
    if (tag === 'polyline') return 'polyline';
    if (tag === 'polygon') return 'polygon';
    if (tag === 'path') return 'path';
    if (tag === 'text') return 'text';
    return null;
  }

  private readStyle(el: SVGElement, type: ShapeData['type']): ShapeStyle {
    const fill = el.getAttribute('fill') ?? (type === 'line' ? 'none' : '#FFFFFF');
    const stroke = el.getAttribute('stroke') ?? '#000000';
    const strokeWidth = parseFloat(el.getAttribute('stroke-width') ?? '1');
    const opacity = parseFloat(el.getAttribute('opacity') ?? '1');
    const style: ShapeStyle = { fill, stroke, strokeWidth, opacity };
    style.strokeLinecap = el.getAttribute('stroke-linecap') ?? 'butt';
    style.strokeLinejoin = el.getAttribute('stroke-linejoin') ?? 'miter';
    style.strokeDasharray = el.getAttribute('stroke-dasharray') ?? '';
    if (type === 'rect') {
      style.rx = parseFloat(el.getAttribute('rx') ?? '0');
    }
    if (type === 'text') {
      style.fontSize = parseFloat(el.getAttribute('font-size') ?? '24');
      style.fontFamily = el.getAttribute('font-family') ?? 'Arial';
      style.fontWeight = el.getAttribute('font-weight') ?? 'normal';
      style.fontStyle = el.getAttribute('font-style') ?? 'normal';
    }
    return style;
  }

  getDrawingLayerSVG(): string {
    return this.drawingLayer.innerHTML;
  }

  clearAll(): void {
    this.drawingLayer.innerHTML = '';
    this.shapes = [];
    this.selectedShapeId = null;
    this.artboards = [{
      id: this.nextArtboardId(),
      x: 0, y: 0, width: 960, height: 540, name: 'Artboard 1',
    }];
    this.activeArtboardId = this.artboards[0].id;
    this.selectedArtboardId = null;
    this.saveHistory();
    this.onChangeCallback();
  }

  importSVGContent(svgString: string): void {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return;
    this.drawingLayer.innerHTML = '';
    this.shapes = [];
    const importElements = (parent: Element) => {
      for (let i = 0; i < parent.children.length; i++) {
        const child = parent.children[i];
        const tag = child.tagName.toLowerCase();
        if (['rect', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text'].includes(tag)) {
          const imported = document.importNode(child, true) as SVGElement;
          const id = this.nextId();
          imported.id = id;
          const type = this.detectType(imported);
          if (!type) continue;
          const name = `${type} ${id.replace('shape-', '#')}`;
          imported.setAttribute('data-name', name);
          this.drawingLayer.appendChild(imported);
          this.shapes.push({
            id, type, element: imported, name,
            style: this.readStyle(imported, type),
            visible: true, locked: false,
          });
        } else if (tag === 'g') {
          importElements(child);
        }
      }
    };
    importElements(svgEl);
    this.selectedShapeId = null;
    this.saveHistory();
    this.onChangeCallback();
  }

  /** Load raw SVG innerHTML into the drawing layer (used by project file loader) */
  importSVGMarkup(svgMarkup: string): void {
    this.drawingLayer.innerHTML = svgMarkup;
    this.rebuildShapesFromDOM();
    this.selectedShapeId = null;
  }
}
