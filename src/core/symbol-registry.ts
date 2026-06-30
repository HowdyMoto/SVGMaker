import type { ShapeData, ShapeStyle, SymbolDef, Artboard } from './types';

/**
 * The slice of the document the symbols subsystem needs. Creating a symbol
 * transforms a shape into a `<use>`, and detaching does the reverse, so this
 * host surface is wide — but it makes that coupling explicit and typed instead
 * of reaching into the AppState god object. AppState supplies it as an adapter
 * (see its constructor). `getShapes()` returns the live model array, so in-place
 * replacements land on the real document.
 */
export interface SymbolHost {
  getShapes(): ShapeData[];
  ensureDefs(): SVGDefsElement;
  nextId(): string;
  detectType(el: SVGElement): ShapeData['type'] | null;
  readStyle(el: SVGElement, type: ShapeData['type']): ShapeStyle;
  getActiveArtboard(): Artboard;
  addShape(shape: ShapeData): void;
  setSelection(ids: string[]): void;
  getSelectedSymbolId(): string | null;
  setSelectedSymbolId(id: string | null): void;
  saveHistory(): void;
  onChange(): void;
}

const NS = 'http://www.w3.org/2000/svg';

/**
 * Owns the document's `<symbol>` definitions: the tracked models surfaced in the
 * Symbols panel, their id counter, and the shape↔`<use>` transformations
 * (create-from-shape, place-instance, detach). Extracted from AppState; all
 * shape-model access goes through {@link SymbolHost}.
 */
export class SymbolRegistry {
  symbols: SymbolDef[] = [];
  private symbolCounter = 0;
  private readonly host: SymbolHost;

  constructor(host: SymbolHost) {
    this.host = host;
  }

  /** Reset tracked symbols + counter. The live `<defs>` DOM is cleared by the
   *  caller (AppState.clearDefs), which owns the shared element. */
  clear(): void {
    this.symbols = [];
    this.symbolCounter = 0;
  }

  private nextSymbolId(): string {
    return `symbol-${++this.symbolCounter}`;
  }

  createSymbolFromShape(shapeId: string): SymbolDef | null {
    const shapes = this.host.getShapes();
    const idx = shapes.findIndex(s => s.id === shapeId);
    if (idx === -1) return null;
    const shape = shapes[idx];

    const defs = this.host.ensureDefs();
    const symbolEl = document.createElementNS(NS, 'symbol');
    const symId = this.nextSymbolId();
    symbolEl.id = symId;

    // Get bounding box for viewBox
    const bbox = (shape.element as unknown as SVGGraphicsElement).getBBox();
    symbolEl.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);

    const clone = shape.element.cloneNode(true) as SVGElement;
    clone.removeAttribute('id');
    symbolEl.appendChild(clone);
    defs.appendChild(symbolEl);

    const symName = shape.name || `Symbol ${symId}`;
    const symbolDef: SymbolDef = { id: symId, name: symName, element: symbolEl as unknown as SVGSymbolElement };
    this.symbols.push(symbolDef);

    const useEl = document.createElementNS(NS, 'use');
    const useId = this.host.nextId();
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
    shapes[idx] = {
      id: useId,
      type: 'use',
      element: useEl,
      name: `${symName} instance`,
      style: { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: parseFloat(shape.element.getAttribute('opacity') ?? '1') },
      visible: true,
      locked: false,
      symbolId: symId,
    };

    this.host.setSelection([useId]);
    this.host.saveHistory();
    this.host.onChange();
    return symbolDef;
  }

  placeSymbolInstance(symId: string): void {
    const sym = this.symbols.find(s => s.id === symId);
    if (!sym) return;

    const viewBox = sym.element.getAttribute('viewBox')?.split(' ').map(Number) ?? [0, 0, 100, 100];
    const ab = this.host.getActiveArtboard();
    const w = viewBox[2];
    const h = viewBox[3];
    const x = ab.x + (ab.width - w) / 2;
    const y = ab.y + (ab.height - h) / 2;

    const useEl = document.createElementNS(NS, 'use');
    const id = this.host.nextId();
    useEl.id = id;
    useEl.setAttribute('href', `#${symId}`);
    useEl.setAttribute('x', String(x));
    useEl.setAttribute('y', String(y));
    useEl.setAttribute('width', String(w));
    useEl.setAttribute('height', String(h));
    const name = `${sym.name} instance`;
    useEl.setAttribute('data-name', name);

    this.host.addShape({
      id, type: 'use', element: useEl, name,
      style: { fill: 'none', stroke: 'none', strokeWidth: 0, opacity: 1 },
      visible: true, locked: false,
      symbolId: symId,
    });
  }

  detachSymbolInstance(shapeId: string): void {
    const shapes = this.host.getShapes();
    const idx = shapes.findIndex(s => s.id === shapeId);
    if (idx === -1) return;
    const shape = shapes[idx];
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
    const newId = this.host.nextId();
    clone.id = newId;
    const type = this.host.detectType(clone);
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
    shapes[idx] = {
      id: newId, type, element: clone, name,
      style: this.host.readStyle(clone, type),
      visible: true, locked: false,
    };

    this.host.setSelection([newId]);
    this.host.saveHistory();
    this.host.onChange();
  }

  /** Remove a symbol definition (existing instances will no longer resolve). */
  removeSymbol(id: string): void {
    const idx = this.symbols.findIndex(s => s.id === id);
    if (idx === -1) return;
    this.symbols[idx].element.remove();
    this.symbols.splice(idx, 1);
    if (this.host.getSelectedSymbolId() === id) this.host.setSelectedSymbolId(null);
    this.host.onChange();
  }

  /**
   * Track a `<symbol>` already imported into the shared `<defs>` so it appears
   * in the Symbols panel and round-trips. The element is in the DOM already;
   * this only assigns/records its id and model entry.
   */
  trackImportedSymbol(imported: SVGElement): void {
    const id = imported.id || this.nextSymbolId();
    imported.id = id;
    const m = id.match(/symbol-(\d+)/);
    if (m) this.symbolCounter = Math.max(this.symbolCounter, parseInt(m[1]));
    this.symbols.push({
      id,
      name: imported.getAttribute('data-name') || `Symbol ${id}`,
      element: imported as unknown as SVGSymbolElement,
    });
  }
}
