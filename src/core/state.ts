import type { ToolName, ShapeData, HistoryEntry, ShapeStyle, Artboard, SymbolDef, GradientDef, GradientStop, PatternDef } from './types';

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
  showTransparency = true; // checkerboard background on by default

  symbols: SymbolDef[] = [];
  private symbolCounter = 0;
  private defsElement: SVGDefsElement | null = null;

  gradients: GradientDef[] = [];
  private gradCounter = 0;
  patterns: PatternDef[] = [];
  private patternCounter = 0;

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
    this.selectedShapeIds = id ? [id] : [];
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

  // ---- Clipboard ----
  private clipboard: { markup: string; type: ShapeData['type']; style: ShapeStyle; rotation?: number; symbolId?: string } | null = null;
  private pasteOffset = 0;

  copyShape(id: string): void {
    const shape = this.shapes.find(s => s.id === id);
    if (!shape) return;
    this.clipboard = {
      markup: shape.element.outerHTML,
      type: shape.type,
      style: { ...shape.style },
      rotation: shape.rotation,
      symbolId: shape.symbolId,
    };
    this.pasteOffset = 0;

    // Also write SVG to system clipboard for cross-app paste
    const svgWrapper = `<svg xmlns="http://www.w3.org/2000/svg">${shape.element.outerHTML}</svg>`;
    navigator.clipboard?.writeText(svgWrapper).catch(() => { /* ignore */ });
  }

  cutShape(id: string): void {
    this.copyShape(id);
    this.removeShape(id);
  }

  pasteClipboard(): void {
    if (!this.clipboard) return;
    this.pasteOffset += 10;

    const parser = new DOMParser();
    const doc = parser.parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${this.clipboard.markup}</svg>`,
      'image/svg+xml'
    );
    const srcEl = doc.querySelector('svg')!.firstElementChild as SVGElement;
    if (!srcEl) return;

    const newEl = document.importNode(srcEl, true) as SVGElement;
    const newId = this.nextId();
    newEl.id = newId;
    const name = `${this.clipboard.type} ${newId.replace('shape-', '#')}`;
    newEl.setAttribute('data-name', name);

    // Offset the pasted element so it doesn't land exactly on top
    this.offsetElement(newEl, this.pasteOffset, this.pasteOffset);

    // For 'use' type, fix up the id but keep href
    if (this.clipboard.type === 'group') {
      // Re-id all children inside the group
      this.reIdGroupChildren(newEl);
    }

    this.addShape({
      id: newId,
      type: this.clipboard.type,
      element: newEl,
      name,
      style: { ...this.clipboard.style },
      visible: true,
      locked: false,
      rotation: this.clipboard.rotation,
      symbolId: this.clipboard.symbolId,
    });
  }

  /** Try to paste SVG content from the system clipboard */
  async pasteFromSystemClipboard(): Promise<boolean> {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.includes('<svg') && !text.includes('<SVG')) return false;

      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'image/svg+xml');
      const svgEl = doc.querySelector('svg');
      if (!svgEl) return false;

      // Import each child element
      let pasted = false;
      for (let i = 0; i < svgEl.children.length; i++) {
        const child = svgEl.children[i];
        const imported = document.importNode(child, true) as SVGElement;
        const type = this.detectType(imported);
        if (!type) continue;

        const id = this.nextId();
        imported.id = id;
        const name = `${type} ${id.replace('shape-', '#')}`;
        imported.setAttribute('data-name', name);

        this.addShape({
          id, type, element: imported, name,
          style: this.readStyle(imported, type),
          visible: true, locked: false,
        });
        pasted = true;
      }
      return pasted;
    } catch {
      return false;
    }
  }

  private offsetElement(el: SVGElement, dx: number, dy: number): void {
    const tag = el.tagName.toLowerCase();
    if (tag === 'rect' || tag === 'text' || tag === 'image' || tag === 'use') {
      el.setAttribute('x', String(parseFloat(el.getAttribute('x') ?? '0') + dx));
      el.setAttribute('y', String(parseFloat(el.getAttribute('y') ?? '0') + dy));
    } else if (tag === 'ellipse') {
      el.setAttribute('cx', String(parseFloat(el.getAttribute('cx') ?? '0') + dx));
      el.setAttribute('cy', String(parseFloat(el.getAttribute('cy') ?? '0') + dy));
    } else if (tag === 'line') {
      el.setAttribute('x1', String(parseFloat(el.getAttribute('x1') ?? '0') + dx));
      el.setAttribute('y1', String(parseFloat(el.getAttribute('y1') ?? '0') + dy));
      el.setAttribute('x2', String(parseFloat(el.getAttribute('x2') ?? '0') + dx));
      el.setAttribute('y2', String(parseFloat(el.getAttribute('y2') ?? '0') + dy));
    } else if (tag === 'polyline' || tag === 'polygon') {
      const points = el.getAttribute('points') ?? '';
      const pairs = points.trim().split(/\s+/).map(p => p.split(',').map(Number));
      const newPoints = pairs.map(([px, py]) => `${px + dx},${py + dy}`).join(' ');
      el.setAttribute('points', newPoints);
    } else if (tag === 'path' || tag === 'g') {
      // Use translate transform
      const existing = el.getAttribute('transform') ?? '';
      const match = existing.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
      if (match) {
        const newTx = parseFloat(match[1]) + dx;
        const newTy = parseFloat(match[2]) + dy;
        el.setAttribute('transform', existing.replace(/translate\(([-\d.]+),\s*([-\d.]+)\)/, `translate(${newTx}, ${newTy})`));
      } else {
        el.setAttribute('transform', (existing ? existing + ' ' : '') + `translate(${dx}, ${dy})`);
      }
    }
  }

  private reIdGroupChildren(groupEl: SVGElement): void {
    for (let i = 0; i < groupEl.children.length; i++) {
      const child = groupEl.children[i] as SVGElement;
      if (child.id) {
        child.id = this.nextId();
      }
      if (child.tagName.toLowerCase() === 'g') {
        this.reIdGroupChildren(child);
      }
    }
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

    const processElement = (el: SVGElement): ShapeData | null => {
      const id = el.id;
      if (!id) return null;
      const numMatch = id.match(/shape-(\d+)/);
      if (numMatch) {
        const num = parseInt(numMatch[1]);
        if (num > maxId) maxId = num;
      }
      const type = this.detectType(el);
      if (!type) return null;

      const shape: ShapeData = {
        id, type, element: el,
        name: el.getAttribute('data-name') || `${type} ${id.replace('shape-', '#')}`,
        style: this.readStyle(el, type),
        visible: el.style.display !== 'none',
        locked: el.getAttribute('data-locked') === 'true',
      };

      // Parse rotation from transform attribute
      const transform = el.getAttribute('transform') ?? '';
      const rotMatch = transform.match(/rotate\(([-\d.]+)/);
      if (rotMatch) {
        shape.rotation = parseFloat(rotMatch[1]);
      }

      // Rebuild children for groups
      if (type === 'group') {
        shape.children = [];
        for (let j = 0; j < el.children.length; j++) {
          const child = processElement(el.children[j] as SVGElement);
          if (child) {
            child.parentId = id;
            shape.children.push(child);
          }
        }
      }

      return shape;
    };

    for (let i = 0; i < elements.length; i++) {
      const shape = processElement(elements[i] as SVGElement);
      if (shape) this.shapes.push(shape);
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
    if (tag === 'g') return 'group';
    if (tag === 'image') return 'image';
    if (tag === 'use') return 'use';
    return null;
  }

  private readStyle(el: SVGElement, type: ShapeData['type']): ShapeStyle {
    if (type === 'group' || type === 'image' || type === 'use') {
      return {
        fill: el.getAttribute('fill') ?? 'none',
        stroke: el.getAttribute('stroke') ?? 'none',
        strokeWidth: parseFloat(el.getAttribute('stroke-width') ?? '0'),
        opacity: parseFloat(el.getAttribute('opacity') ?? '1'),
      };
    }
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

  // Multi-selection support
  selectedShapeIds: string[] = [];

  selectMultiple(ids: string[]): void {
    this.selectedShapeIds = ids;
    this.selectedShapeId = ids.length > 0 ? ids[ids.length - 1] : null;
    this.onChangeCallback();
  }

  toggleMultiSelect(id: string): void {
    const idx = this.selectedShapeIds.indexOf(id);
    if (idx >= 0) {
      this.selectedShapeIds.splice(idx, 1);
    } else {
      this.selectedShapeIds.push(id);
    }
    this.selectedShapeId = this.selectedShapeIds.length > 0
      ? this.selectedShapeIds[this.selectedShapeIds.length - 1]
      : null;
    this.onChangeCallback();
  }

  findShapeById(id: string, list?: ShapeData[]): ShapeData | null {
    const shapes = list ?? this.shapes;
    for (const s of shapes) {
      if (s.id === id) return s;
      if (s.children) {
        const found = this.findShapeById(id, s.children);
        if (found) return found;
      }
    }
    return null;
  }

  groupSelectedShapes(): void {
    const ids = this.selectedShapeIds.length > 1
      ? this.selectedShapeIds
      : this.shapes.filter(s => this.selectedShapeIds.includes(s.id) || s.id === this.selectedShapeId).map(s => s.id);

    if (ids.length < 2) return;

    // Get shapes to group (in their current order)
    const toGroup: ShapeData[] = [];
    const remaining: ShapeData[] = [];
    let insertIdx = -1;

    for (let i = 0; i < this.shapes.length; i++) {
      if (ids.includes(this.shapes[i].id)) {
        if (insertIdx === -1) insertIdx = remaining.length;
        toGroup.push(this.shapes[i]);
      } else {
        remaining.push(this.shapes[i]);
      }
    }

    if (toGroup.length < 2) return;

    // Create SVG <g> element
    const gEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const groupId = this.nextId();
    gEl.id = groupId;
    const groupName = `Group ${groupId.replace('shape-', '#')}`;
    gEl.setAttribute('data-name', groupName);

    // Move shape elements into the group
    for (const s of toGroup) {
      gEl.appendChild(s.element);
      s.parentId = groupId;
    }

    // Insert group element into drawing layer at the right position
    const insertBefore = remaining[insertIdx]?.element ?? null;
    if (insertBefore) {
      this.drawingLayer.insertBefore(gEl, insertBefore);
    } else {
      this.drawingLayer.appendChild(gEl);
    }

    const groupShape: ShapeData = {
      id: groupId,
      type: 'group',
      element: gEl,
      name: groupName,
      style: { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1 },
      visible: true,
      locked: false,
      children: toGroup,
    };

    remaining.splice(insertIdx, 0, groupShape);
    this.shapes = remaining;
    this.selectedShapeIds = [groupId];
    this.selectedShapeId = groupId;
    this.saveHistory();
    this.onChangeCallback();
  }

  ungroupShape(id: string): void {
    const idx = this.shapes.findIndex(s => s.id === id);
    if (idx === -1) return;
    const group = this.shapes[idx];
    if (group.type !== 'group' || !group.children) return;

    // Move children out of the group element back to drawing layer
    const gEl = group.element;
    const nextSibling = gEl.nextSibling;
    const children = [...group.children];

    for (const child of children) {
      child.parentId = undefined;
      if (nextSibling) {
        this.drawingLayer.insertBefore(child.element, nextSibling);
      } else {
        this.drawingLayer.appendChild(child.element);
      }
    }

    // Remove the group element
    gEl.remove();

    // Replace group in shapes array with its children
    this.shapes.splice(idx, 1, ...children);
    this.selectedShapeIds = children.map(c => c.id);
    this.selectedShapeId = children.length > 0 ? children[children.length - 1].id : null;
    this.saveHistory();
    this.onChangeCallback();
  }

  private ensureDefs(): SVGDefsElement {
    if (this.defsElement) return this.defsElement;
    const svgCanvas = this.drawingLayer.closest('svg');
    if (!svgCanvas) throw new Error('No SVG parent found');
    let defs = svgCanvas.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svgCanvas.insertBefore(defs, svgCanvas.firstChild);
    }
    this.defsElement = defs as SVGDefsElement;
    return this.defsElement;
  }

  private nextSymbolId(): string {
    return `symbol-${++this.symbolCounter}`;
  }

  createSymbolFromShape(shapeId: string): SymbolDef | null {
    const idx = this.shapes.findIndex(s => s.id === shapeId);
    if (idx === -1) return null;
    const shape = this.shapes[idx];

    const defs = this.ensureDefs();
    const symbolEl = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
    const symId = this.nextSymbolId();
    symbolEl.id = symId;

    // Get bounding box for viewBox
    const bbox = (shape.element as unknown as SVGGraphicsElement).getBBox();
    symbolEl.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);

    // Clone the shape element into the symbol
    const clone = shape.element.cloneNode(true) as SVGElement;
    clone.removeAttribute('id');
    symbolEl.appendChild(clone);
    defs.appendChild(symbolEl);

    const symName = shape.name || `Symbol ${symId}`;
    const symbolDef: SymbolDef = { id: symId, name: symName, element: symbolEl as unknown as SVGSymbolElement };
    this.symbols.push(symbolDef);

    // Replace the original shape with a <use> element
    const useEl = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    const useId = this.nextId();
    useEl.id = useId;
    useEl.setAttribute('href', `#${symId}`);
    useEl.setAttribute('x', String(bbox.x));
    useEl.setAttribute('y', String(bbox.y));
    useEl.setAttribute('width', String(bbox.width));
    useEl.setAttribute('height', String(bbox.height));
    useEl.setAttribute('data-name', `${symName} instance`);

    // Replace in DOM
    shape.element.replaceWith(useEl);

    // Replace in shapes array
    this.shapes[idx] = {
      id: useId,
      type: 'use',
      element: useEl,
      name: `${symName} instance`,
      style: { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: parseFloat(shape.element.getAttribute('opacity') ?? '1') },
      visible: true,
      locked: false,
      symbolId: symId,
    };

    this.selectedShapeId = useId;
    this.selectedShapeIds = [useId];
    this.saveHistory();
    this.onChangeCallback();
    return symbolDef;
  }

  placeSymbolInstance(symId: string): void {
    const sym = this.symbols.find(s => s.id === symId);
    if (!sym) return;

    const viewBox = sym.element.getAttribute('viewBox')?.split(' ').map(Number) ?? [0, 0, 100, 100];
    const ab = this.getActiveArtboard();
    const w = viewBox[2];
    const h = viewBox[3];
    const x = ab.x + (ab.width - w) / 2;
    const y = ab.y + (ab.height - h) / 2;

    const useEl = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    const id = this.nextId();
    useEl.id = id;
    useEl.setAttribute('href', `#${symId}`);
    useEl.setAttribute('x', String(x));
    useEl.setAttribute('y', String(y));
    useEl.setAttribute('width', String(w));
    useEl.setAttribute('height', String(h));
    const name = `${sym.name} instance`;
    useEl.setAttribute('data-name', name);

    this.addShape({
      id, type: 'use', element: useEl, name,
      style: { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1 },
      visible: true, locked: false,
      symbolId: symId,
    });
  }

  detachSymbolInstance(shapeId: string): void {
    const idx = this.shapes.findIndex(s => s.id === shapeId);
    if (idx === -1) return;
    const shape = this.shapes[idx];
    if (shape.type !== 'use' || !shape.symbolId) return;

    const sym = this.symbols.find(s => s.id === shape.symbolId);
    if (!sym) return;

    // Get position/size of the use element
    const useEl = shape.element;
    const x = parseFloat(useEl.getAttribute('x') ?? '0');
    const y = parseFloat(useEl.getAttribute('y') ?? '0');
    const w = parseFloat(useEl.getAttribute('width') ?? '100');
    const h = parseFloat(useEl.getAttribute('height') ?? '100');

    // Clone the symbol content
    const symbolContent = sym.element.firstElementChild;
    if (!symbolContent) return;

    const clone = document.importNode(symbolContent, true) as SVGElement;
    const newId = this.nextId();
    clone.id = newId;
    const type = this.detectType(clone);
    if (!type) return;

    // Position the clone to match the use element placement
    const viewBox = sym.element.getAttribute('viewBox')?.split(' ').map(Number) ?? [0, 0, w, h];
    const scaleX = w / viewBox[2];
    const scaleY = h / viewBox[3];
    if (scaleX !== 1 || scaleY !== 1 || x !== viewBox[0] || y !== viewBox[1]) {
      const tx = x - viewBox[0] * scaleX;
      const ty = y - viewBox[1] * scaleY;
      clone.setAttribute('transform', `translate(${tx}, ${ty}) scale(${scaleX}, ${scaleY})`);
    }

    const name = `${type} ${newId.replace('shape-', '#')}`;
    clone.setAttribute('data-name', name);

    // Replace in DOM
    useEl.replaceWith(clone);

    // Replace in shapes array
    this.shapes[idx] = {
      id: newId, type, element: clone, name,
      style: this.readStyle(clone, type),
      visible: true, locked: false,
    };

    this.selectedShapeId = newId;
    this.selectedShapeIds = [newId];
    this.saveHistory();
    this.onChangeCallback();
  }

  // ---- Gradient management ----

  createGradient(type: 'linear' | 'radial', stops?: GradientStop[]): GradientDef {
    const id = `grad-${++this.gradCounter}`;
    const defaultStops: GradientStop[] = stops ?? [
      { offset: 0, color: '#000000', opacity: 1 },
      { offset: 1, color: '#FFFFFF', opacity: 1 },
    ];
    const grad: GradientDef = {
      id, type, stops: defaultStops,
      spreadMethod: 'pad',
      ...(type === 'linear'
        ? { x1: 0, y1: 0, x2: 1, y2: 0 }
        : { cx: 0.5, cy: 0.5, r: 0.5, fx: 0.5, fy: 0.5 }),
    };
    this.gradients.push(grad);
    this.syncGradientToDefs(grad);
    return grad;
  }

  updateGradient(grad: GradientDef): void {
    const idx = this.gradients.findIndex(g => g.id === grad.id);
    if (idx >= 0) this.gradients[idx] = grad;
    this.syncGradientToDefs(grad);
    this.onChangeCallback();
  }

  removeGradient(id: string): void {
    this.gradients = this.gradients.filter(g => g.id !== id);
    const defs = this.ensureDefs();
    const el = defs.querySelector(`#${id}`);
    if (el) el.remove();
  }

  getGradientById(id: string): GradientDef | undefined {
    return this.gradients.find(g => g.id === id);
  }

  private syncGradientToDefs(grad: GradientDef): void {
    const defs = this.ensureDefs();
    const NS = 'http://www.w3.org/2000/svg';

    // Remove existing
    const existing = defs.querySelector(`#${grad.id}`);
    if (existing) existing.remove();

    const el = document.createElementNS(NS,
      grad.type === 'linear' ? 'linearGradient' : 'radialGradient');
    el.id = grad.id;

    if (grad.type === 'linear') {
      el.setAttribute('x1', String(grad.x1 ?? 0));
      el.setAttribute('y1', String(grad.y1 ?? 0));
      el.setAttribute('x2', String(grad.x2 ?? 1));
      el.setAttribute('y2', String(grad.y2 ?? 0));
    } else {
      el.setAttribute('cx', String(grad.cx ?? 0.5));
      el.setAttribute('cy', String(grad.cy ?? 0.5));
      el.setAttribute('r', String(grad.r ?? 0.5));
      el.setAttribute('fx', String(grad.fx ?? 0.5));
      el.setAttribute('fy', String(grad.fy ?? 0.5));
    }
    el.setAttribute('spreadMethod', grad.spreadMethod ?? 'pad');

    for (const stop of grad.stops) {
      const s = document.createElementNS(NS, 'stop');
      s.setAttribute('offset', String(stop.offset));
      s.setAttribute('stop-color', stop.color);
      if (stop.opacity < 1) s.setAttribute('stop-opacity', String(stop.opacity));
      el.appendChild(s);
    }

    defs.appendChild(el);
  }

  // ---- Pattern management ----

  createPattern(def: Partial<PatternDef> & { type: PatternDef['type'] }): PatternDef {
    const id = `pat-${++this.patternCounter}`;
    const pat: PatternDef = {
      id, type: def.type,
      preset: def.preset,
      presetColor: def.presetColor ?? '#000000',
      imageDataUrl: def.imageDataUrl,
      scale: def.scale ?? 1,
      rotation: def.rotation ?? 0,
      spacing: def.spacing ?? 0,
      tileWidth: def.tileWidth ?? 20,
      tileHeight: def.tileHeight ?? 20,
    };
    this.patterns.push(pat);
    this.syncPatternToDefs(pat);
    return pat;
  }

  updatePattern(pat: PatternDef): void {
    const idx = this.patterns.findIndex(p => p.id === pat.id);
    if (idx >= 0) this.patterns[idx] = pat;
    this.syncPatternToDefs(pat);
    this.onChangeCallback();
  }

  removePattern(id: string): void {
    this.patterns = this.patterns.filter(p => p.id !== id);
    const defs = this.ensureDefs();
    const el = defs.querySelector(`#${id}`);
    if (el) el.remove();
  }

  getPatternById(id: string): PatternDef | undefined {
    return this.patterns.find(p => p.id === id);
  }

  private syncPatternToDefs(pat: PatternDef): void {
    const defs = this.ensureDefs();
    const NS = 'http://www.w3.org/2000/svg';

    const existing = defs.querySelector(`#${pat.id}`);
    if (existing) existing.remove();

    const tw = pat.tileWidth * pat.scale + pat.spacing;
    const th = pat.tileHeight * pat.scale + pat.spacing;

    const el = document.createElementNS(NS, 'pattern');
    el.id = pat.id;
    el.setAttribute('width', String(tw));
    el.setAttribute('height', String(th));
    el.setAttribute('patternUnits', 'userSpaceOnUse');

    if (pat.rotation !== 0) {
      el.setAttribute('patternTransform', `rotate(${pat.rotation})`);
    }

    if (pat.type === 'image' && pat.imageDataUrl) {
      const img = document.createElementNS(NS, 'image');
      img.setAttribute('href', pat.imageDataUrl);
      img.setAttribute('width', String(pat.tileWidth * pat.scale));
      img.setAttribute('height', String(pat.tileHeight * pat.scale));
      img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      el.appendChild(img);
    } else if (pat.type === 'preset') {
      this.buildPresetPatternContent(el, pat, tw, th);
    }

    defs.appendChild(el);
  }

  private buildPresetPatternContent(el: SVGPatternElement, pat: PatternDef, tw: number, th: number): void {
    const NS = 'http://www.w3.org/2000/svg';
    const color = pat.presetColor ?? '#000000';
    const s = pat.scale;

    switch (pat.preset) {
      case 'dots': {
        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('cx', String(tw / 2));
        dot.setAttribute('cy', String(th / 2));
        dot.setAttribute('r', String(2 * s));
        dot.setAttribute('fill', color);
        el.appendChild(dot);
        break;
      }
      case 'stripes': {
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', '0'); line.setAttribute('y1', '0');
        line.setAttribute('x2', '0'); line.setAttribute('y2', String(th));
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', String(Math.max(1, 2 * s)));
        el.appendChild(line);
        break;
      }
      case 'crosshatch': {
        const l1 = document.createElementNS(NS, 'line');
        l1.setAttribute('x1', '0'); l1.setAttribute('y1', '0');
        l1.setAttribute('x2', String(tw)); l1.setAttribute('y2', String(th));
        l1.setAttribute('stroke', color); l1.setAttribute('stroke-width', String(Math.max(0.5, s)));
        el.appendChild(l1);
        const l2 = document.createElementNS(NS, 'line');
        l2.setAttribute('x1', String(tw)); l2.setAttribute('y1', '0');
        l2.setAttribute('x2', '0'); l2.setAttribute('y2', String(th));
        l2.setAttribute('stroke', color); l2.setAttribute('stroke-width', String(Math.max(0.5, s)));
        el.appendChild(l2);
        break;
      }
      case 'grid': {
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', `M ${tw} 0 L 0 0 0 ${th}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', String(Math.max(0.5, s)));
        el.appendChild(path);
        break;
      }
    }
  }

  // ---- Defs export ----

  getDefsContent(): string {
    const parts: string[] = [];
    for (const s of this.symbols) parts.push(s.element.outerHTML);
    const defs = this.defsElement;
    if (defs) {
      // Export gradients and patterns from the live defs element
      for (const child of Array.from(defs.children)) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'lineargradient' || tag === 'radialgradient' || tag === 'pattern') {
          parts.push(child.outerHTML);
        }
      }
    }
    return parts.join('\n');
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

  private importDefsFromSVG(svgEl: Element): void {
    const defsEl = svgEl.querySelector('defs');
    if (!defsEl) return;

    for (const child of Array.from(defsEl.children)) {
      const tag = child.tagName.toLowerCase();

      if (tag === 'lineargradient' || tag === 'radialgradient') {
        const type = tag === 'lineargradient' ? 'linear' as const : 'radial' as const;
        const id = child.id || `grad-${++this.gradCounter}`;
        const stops: GradientStop[] = [];
        for (const stopEl of Array.from(child.querySelectorAll('stop'))) {
          stops.push({
            offset: parseFloat(stopEl.getAttribute('offset') ?? '0'),
            color: stopEl.getAttribute('stop-color') ?? '#000000',
            opacity: parseFloat(stopEl.getAttribute('stop-opacity') ?? '1'),
          });
        }
        const grad: GradientDef = {
          id, type, stops,
          spreadMethod: (child.getAttribute('spreadMethod') as GradientDef['spreadMethod']) ?? 'pad',
          x1: parseFloat(child.getAttribute('x1') ?? '0'),
          y1: parseFloat(child.getAttribute('y1') ?? '0'),
          x2: parseFloat(child.getAttribute('x2') ?? '1'),
          y2: parseFloat(child.getAttribute('y2') ?? '0'),
          cx: parseFloat(child.getAttribute('cx') ?? '0.5'),
          cy: parseFloat(child.getAttribute('cy') ?? '0.5'),
          r: parseFloat(child.getAttribute('r') ?? '0.5'),
          fx: parseFloat(child.getAttribute('fx') ?? '0.5'),
          fy: parseFloat(child.getAttribute('fy') ?? '0.5'),
        };
        this.gradients.push(grad);

        // Ensure counter stays ahead
        const m = id.match(/grad-(\d+)/);
        if (m) this.gradCounter = Math.max(this.gradCounter, parseInt(m[1]));

        // Copy element into our defs
        const imported = document.importNode(child, true) as SVGElement;
        this.ensureDefs().appendChild(imported);
      }

      if (tag === 'pattern') {
        const id = child.id || `pat-${++this.patternCounter}`;
        const m = id.match(/pat-(\d+)/);
        if (m) this.patternCounter = Math.max(this.patternCounter, parseInt(m[1]));

        // Copy element into our defs as-is
        const imported = document.importNode(child, true) as SVGElement;
        this.ensureDefs().appendChild(imported);

        // Create a minimal PatternDef for tracking
        this.patterns.push({
          id, type: 'preset', preset: 'grid',
          presetColor: '#000000',
          scale: 1, rotation: 0, spacing: 0,
          tileWidth: parseFloat(child.getAttribute('width') ?? '20'),
          tileHeight: parseFloat(child.getAttribute('height') ?? '20'),
        });
      }
    }
  }

  importSVGContent(svgString: string): void {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return;
    this.drawingLayer.innerHTML = '';
    this.shapes = [];

    // Import gradients and patterns from defs
    this.importDefsFromSVG(svgEl);

    const importElements = (parent: Element, targetParent: Element): ShapeData[] => {
      const imported: ShapeData[] = [];
      for (let i = 0; i < parent.children.length; i++) {
        const child = parent.children[i];
        const tag = child.tagName.toLowerCase();
        if (['rect', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'image'].includes(tag)) {
          const importedEl = document.importNode(child, true) as SVGElement;
          const id = this.nextId();
          importedEl.id = id;
          const type = this.detectType(importedEl);
          if (!type) continue;
          const name = `${type} ${id.replace('shape-', '#')}`;
          importedEl.setAttribute('data-name', name);
          targetParent.appendChild(importedEl);
          imported.push({
            id, type, element: importedEl, name,
            style: this.readStyle(importedEl, type),
            visible: true, locked: false,
          });
        } else if (tag === 'g') {
          const gEl = document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
          const id = this.nextId();
          gEl.id = id;
          const name = `Group ${id.replace('shape-', '#')}`;
          gEl.setAttribute('data-name', name);
          // Copy transform attribute from source group
          const transform = child.getAttribute('transform');
          if (transform) gEl.setAttribute('transform', transform);
          targetParent.appendChild(gEl);
          const children = importElements(child, gEl);
          children.forEach(c => c.parentId = id);
          imported.push({
            id, type: 'group', element: gEl, name,
            style: this.readStyle(gEl, 'group'),
            visible: true, locked: false,
            children,
          });
        }
      }
      return imported;
    };
    this.shapes = importElements(svgEl, this.drawingLayer);
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
