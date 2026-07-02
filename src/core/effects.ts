// ---------------------------------------------------------------------------
// Object effects — non-destructive blur + drop shadow via SVG <filter>.
//
// The effect PARAMETERS are the source of truth and live as data-fx-* attributes
// on the element, so they round-trip through the history/innerHTML snapshot. The
// generated <filter> in <defs> is a regenerated CACHE (defs aren't snapshotted),
// so ensureFilters() rebuilds it after every rebuild/import/undo.
//
// Extracted from AppState as a collaborator (like History/PaintRegistry/
// ClipboardManager/SymbolRegistry): it reaches the few AppState primitives it
// needs through the EffectsHost seam rather than owning any document state.
// ---------------------------------------------------------------------------

import type { ObjectShadow } from './types';

const SVG = 'http://www.w3.org/2000/svg';

export interface EffectsHost {
  ensureDefs(): SVGDefsElement;
  getDrawingLayer(): SVGGElement;
  findShapeElement(id: string): SVGElement | null;
  /** Elements of the current selection, resolved anywhere in the tree. */
  selectionElements(): SVGElement[];
  saveHistory(): void;
  onChange(): void;
}

export class EffectsManager {
  private host: EffectsHost;
  constructor(host: EffectsHost) { this.host = host; }

  getObjectEffects(id: string): { blur: number; shadow: ObjectShadow | null } {
    const el = this.host.findShapeElement(id);
    const blur = el ? (parseFloat(el.getAttribute('data-fx-blur') || '0') || 0) : 0;
    let shadow: ObjectShadow | null = null;
    const sa = el?.getAttribute('data-fx-shadow');
    if (sa) {
      const [dx, dy, b, color, op] = sa.split(',');
      shadow = { dx: parseFloat(dx) || 0, dy: parseFloat(dy) || 0, blur: parseFloat(b) || 0, color: color || '#000000', opacity: parseFloat(op) || 0 };
    }
    return { blur, shadow };
  }

  // `record` lets a slider apply live on `input` (record=false) and commit one
  // history entry on `change` (record=true), so a drag doesn't flood undo.
  private applyBlurTo(el: SVGElement, stdDev: number): void {
    if (stdDev > 0) el.setAttribute('data-fx-blur', String(stdDev));
    else el.removeAttribute('data-fx-blur');
    this.applyFilter(el);
  }

  private applyShadowTo(el: SVGElement, shadow: ObjectShadow | null): void {
    if (shadow) el.setAttribute('data-fx-shadow', `${shadow.dx},${shadow.dy},${shadow.blur},${shadow.color},${shadow.opacity}`);
    else el.removeAttribute('data-fx-shadow');
    this.applyFilter(el);
  }

  setObjectBlur(id: string, stdDev: number, record = true): void {
    const el = this.host.findShapeElement(id);
    if (!el) return;
    this.applyBlurTo(el, stdDev);
    if (record) this.host.saveHistory();
    this.host.onChange();
  }

  setObjectShadow(id: string, shadow: ObjectShadow | null, record = true): void {
    const el = this.host.findShapeElement(id);
    if (!el) return;
    this.applyShadowTo(el, shadow);
    if (record) this.host.saveHistory();
    this.host.onChange();
  }

  /** Apply blur to every selected object in a single undo step. */
  setSelectionBlur(stdDev: number, record = true): void {
    for (const el of this.host.selectionElements()) this.applyBlurTo(el, stdDev);
    if (record) this.host.saveHistory();
    this.host.onChange();
  }

  setSelectionShadow(shadow: ObjectShadow | null, record = true): void {
    for (const el of this.host.selectionElements()) this.applyShadowTo(el, shadow);
    if (record) this.host.saveHistory();
    this.host.onChange();
  }

  /** (Re)build or remove an element's `<filter>` from its data-fx-* attributes.
   *  Also called by the appearance/width wrappers when they move fx attrs. */
  applyFilter(el: SVGElement): void {
    const blur = parseFloat(el.getAttribute('data-fx-blur') || '0') || 0;
    const shadowAttr = el.getAttribute('data-fx-shadow');
    const fid = `fx-${el.id}`;
    const defs = this.host.ensureDefs();
    defs.querySelector(`[id="${fid}"]`)?.remove();

    if (blur <= 0 && !shadowAttr) {
      if (el.getAttribute('filter') === `url(#${fid})`) el.removeAttribute('filter');
      return;
    }
    const filter = document.createElementNS(SVG, 'filter');
    filter.setAttribute('id', fid);
    // Roomy region so blur / shadow spread isn't clipped.
    filter.setAttribute('x', '-50%'); filter.setAttribute('y', '-50%');
    filter.setAttribute('width', '200%'); filter.setAttribute('height', '200%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    let input = 'SourceGraphic';
    if (blur > 0) {
      const fe = document.createElementNS(SVG, 'feGaussianBlur');
      fe.setAttribute('in', input); fe.setAttribute('stdDeviation', String(blur));
      fe.setAttribute('result', 'fxblur'); filter.appendChild(fe); input = 'fxblur';
    }
    if (shadowAttr) {
      const [dx, dy, b, color, op] = shadowAttr.split(',');
      const fe = document.createElementNS(SVG, 'feDropShadow');
      fe.setAttribute('in', input);
      fe.setAttribute('dx', dx || '0'); fe.setAttribute('dy', dy || '0');
      fe.setAttribute('stdDeviation', b || '0');
      fe.setAttribute('flood-color', color || '#000000');
      fe.setAttribute('flood-opacity', op || '1');
      filter.appendChild(fe);
    }
    defs.appendChild(filter);
    el.setAttribute('filter', `url(#${fid})`);
  }

  /** Regenerate every effect filter from its element's data-fx-* attrs (defs are
   *  not part of the history snapshot, so they must be rebuilt after restore). */
  ensureFilters(): void {
    this.host.getDrawingLayer().querySelectorAll('[data-fx-blur],[data-fx-shadow]')
      .forEach((el) => this.applyFilter(el as SVGElement));
  }
}
