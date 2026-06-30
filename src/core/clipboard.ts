import type { ShapeData, ShapeStyle } from './types';
import { sanitizeSvgElement } from './svg-sanitize';

/** One copied shape, captured as serialized markup so paste is self-contained. */
interface ClipboardEntry {
  markup: string;
  type: ShapeData['type'];
  style: ShapeStyle;
  rotation?: number;
  symbolId?: string;
}

/**
 * The slice of the document model the clipboard needs to copy out of and paste
 * back into. Clipboard is inherently coupled to the shape model — it creates and
 * deletes shapes — so this host surface is deliberately wide, but it makes that
 * dependency explicit and typed rather than reaching into the AppState god
 * object. AppState supplies it as an adapter (see its constructor).
 */
export interface ClipboardHost {
  getShapes(): ShapeData[];
  getDrawingLayer(): SVGGElement;
  getSelectedShapeIds(): string[];
  setSelection(ids: string[]): void;
  findShape(id: string): ShapeData | null;
  removeShape(id: string): void;
  removeSelected(): void;
  nextId(): string;
  offsetElement(el: SVGElement, dx: number, dy: number): void;
  reIdGroupChildren(el: SVGElement): void;
  detectType(el: SVGElement): ShapeData['type'] | null;
  readStyle(el: SVGElement, type: ShapeData['type']): ShapeStyle;
  addShape(shape: ShapeData): void;
  saveHistory(): void;
  onChange(): void;
}

/**
 * Cut / copy / paste. Owns the in-app clipboard buffer and the paste offset,
 * mirrors copies to the system clipboard for cross-app paste, and reads SVG back
 * from the system clipboard. Extracted from AppState; all shape-model access
 * goes through {@link ClipboardHost}.
 */
export class ClipboardManager {
  private clipboard: ClipboardEntry[] = [];
  private pasteOffset = 0;
  private readonly host: ClipboardHost;

  constructor(host: ClipboardHost) {
    this.host = host;
  }

  private snapshotShape(shape: ShapeData): ClipboardEntry {
    return {
      markup: shape.element.outerHTML,
      type: shape.type,
      style: { ...shape.style },
      rotation: shape.rotation,
      symbolId: shape.symbolId,
    };
  }

  /** Replace the clipboard and mirror it to the system clipboard for cross-app paste. */
  private setClipboard(entries: ClipboardEntry[]): void {
    this.clipboard = entries;
    this.pasteOffset = 0;
    const markup = entries.map(e => e.markup).join('');
    const svgWrapper = `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`;
    navigator.clipboard?.writeText(svgWrapper).catch(() => { /* ignore */ });
  }

  copyShape(id: string): void {
    const shape = this.host.getShapes().find(s => s.id === id);
    if (!shape) return;
    this.setClipboard([this.snapshotShape(shape)]);
  }

  /**
   * Copy the whole current selection (in selection order), resolving nested
   * shapes too so cut copies exactly what removeSelected deletes.
   */
  copySelected(): void {
    const shapes = this.host.getSelectedShapeIds()
      .map(id => this.host.findShape(id))
      .filter((s): s is ShapeData => s !== null);
    if (shapes.length === 0) return;
    this.setClipboard(shapes.map(s => this.snapshotShape(s)));
  }

  cutShape(id: string): void {
    this.copyShape(id);
    this.host.removeShape(id);
  }

  cutSelected(): void {
    this.copySelected();
    this.host.removeSelected();
  }

  /** Paste the internal clipboard. Returns true if anything was pasted. */
  pasteClipboard(): boolean {
    if (this.clipboard.length === 0) return false;
    this.pasteOffset += 10;
    const newIds: string[] = [];
    for (const entry of this.clipboard) {
      const id = this.insertClipboardEntry(entry, this.pasteOffset);
      if (id) newIds.push(id);
    }
    if (newIds.length === 0) return false;
    this.host.setSelection(newIds);
    this.host.saveHistory();
    this.host.onChange();
    return true;
  }

  /** Materialize one clipboard entry into the drawing layer; returns the new id. */
  private insertClipboardEntry(entry: ClipboardEntry, offset: number): string | null {
    const parser = new DOMParser();
    const doc = parser.parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${entry.markup}</svg>`,
      'image/svg+xml'
    );
    const srcEl = doc.querySelector('svg')?.firstElementChild as SVGElement | null;
    if (!srcEl) return null;

    const newEl = document.importNode(srcEl, true) as SVGElement;
    sanitizeSvgElement(newEl); // strip event handlers / unsafe refs from untrusted markup
    const newId = this.host.nextId();
    newEl.id = newId;
    const name = `${entry.type} ${newId.replace('shape-', '#')}`;
    newEl.setAttribute('data-name', name);

    // Offset so the paste doesn't land exactly on top of the original.
    this.host.offsetElement(newEl, offset, offset);

    // Re-id nested children so a pasted group doesn't collide with the source.
    if (entry.type === 'group') this.host.reIdGroupChildren(newEl);

    this.host.getShapes().push({
      id: newId,
      type: entry.type,
      element: newEl,
      name,
      style: { ...entry.style },
      visible: true,
      locked: false,
      rotation: entry.rotation,
      symbolId: entry.symbolId,
    });
    this.host.getDrawingLayer().appendChild(newEl);
    return newId;
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

      let pasted = false;
      for (let i = 0; i < svgEl.children.length; i++) {
        const child = svgEl.children[i];
        const imported = document.importNode(child, true) as SVGElement;
        sanitizeSvgElement(imported); // untrusted system-clipboard SVG
        const type = this.host.detectType(imported);
        if (!type) continue;

        const id = this.host.nextId();
        imported.id = id;
        const name = `${type} ${id.replace('shape-', '#')}`;
        imported.setAttribute('data-name', name);

        this.host.addShape({
          id, type, element: imported, name,
          style: this.host.readStyle(imported, type),
          visible: true, locked: false,
        });
        pasted = true;
      }
      return pasted;
    } catch {
      return false;
    }
  }
}
