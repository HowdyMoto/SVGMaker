// ---------------------------------------------------------------------------
// Appearance stack — multiple fills / strokes on one object (Illustrator's
// Appearance panel).
//
// SVG paints a single element with one fill + one stroke, so a rich stack is
// stored as a `<g data-appearance="[layers]">` wrapper. Inside it:
//   • one hidden `[data-ap-src]` element → the canonical geometry (the object the
//     user actually drew), fill+stroke cleared;
//   • N `[data-ap]` render-clones of that geometry, one per visible layer, each
//     painted with a single fill or stroke, stacked bottom→top.
// The render-clones live in the drawing layer, so they round-trip through the
// history/innerHTML snapshot for free; rebuildShapesFromDOM models the wrapper as
// a LEAF (type 'appearance') and never walks into it. When a stack collapses to
// ≤1 fill and ≤1 stroke we UNWRAP back to a plain native element.
//
// Extracted from AppState as a collaborator (see EffectsManager / MarkersManager):
// it reaches AppState only through the AppearanceHost seam.
// ---------------------------------------------------------------------------

import type { ShapeData, AppearanceLayer } from './types';
import { CARRY_ATTRS } from './wrapper-attrs';

const SVG = 'http://www.w3.org/2000/svg';

export interface AppearanceHost {
  findShape(id: string): ShapeData | null;
  /** Rebuild/remove an element's effect <filter> from its data-fx-* attrs. */
  applyEffectFilter(el: SVGElement): void;
  rebuild(): void;
  setSelection(ids: string[]): void;
  saveHistory(): void;
  onChange(): void;
}

export class AppearanceManager {
  private host: AppearanceHost;
  constructor(host: AppearanceHost) { this.host = host; }

  private parse(wrapperEl: SVGElement): AppearanceLayer[] {
    try {
      const raw = JSON.parse(wrapperEl.getAttribute('data-appearance') || '[]');
      if (!Array.isArray(raw)) return [];
      return raw.filter((l): l is AppearanceLayer => l && (l.t === 'fill' || l.t === 'stroke'));
    } catch { return []; }
  }

  /** ≤1 visible/expressible fill and ≤1 stroke, no per-layer blend → expressible
   *  as a plain element (so we can unwrap and keep it fully editable). */
  private isTrivial(layers: AppearanceLayer[]): boolean {
    const fills = layers.filter(l => l.t === 'fill');
    const strokes = layers.filter(l => l.t === 'stroke');
    if (fills.length > 1 || strokes.length > 1) return false;
    return layers.every(l => !l.blend);
  }

  /** Write a trivial (≤1 fill, ≤1 stroke) stack onto a plain element's native
   *  presentation attributes. A hidden or absent layer becomes paint 'none'. */
  private applyTrivialToNative(el: SVGElement, layers: AppearanceLayer[]): void {
    const fill = layers.find(l => l.t === 'fill');
    const stroke = layers.find(l => l.t === 'stroke');
    if (fill && fill.visible !== false && fill.paint !== 'none') {
      el.setAttribute('fill', fill.paint);
      if (fill.opacity < 1) el.setAttribute('fill-opacity', String(fill.opacity));
      else el.removeAttribute('fill-opacity');
    } else {
      el.setAttribute('fill', 'none');
      el.removeAttribute('fill-opacity');
    }
    if (stroke && stroke.visible !== false && stroke.paint !== 'none') {
      el.setAttribute('stroke', stroke.paint);
      el.setAttribute('stroke-width', String(stroke.width ?? 1));
      if (stroke.opacity < 1) el.setAttribute('stroke-opacity', String(stroke.opacity));
      else el.removeAttribute('stroke-opacity');
    } else {
      el.removeAttribute('stroke');
      el.removeAttribute('stroke-width');
      el.removeAttribute('stroke-opacity');
    }
  }

  /** Rebuild a wrapper's `[data-ap]` render-clones from its geometry + stack, and
   *  seed representative paint on the wrapper. Called on every stack edit; idempotent. */
  private regenerate(wrapperEl: SVGElement): void {
    const src = wrapperEl.querySelector(':scope > [data-ap-src]') as SVGElement | null;
    if (!src) return;
    wrapperEl.querySelectorAll(':scope > [data-ap]').forEach(n => n.remove());
    const layers = this.parse(wrapperEl);

    // Paint bottom→top: later DOM siblings render on top, and layers[0] is the
    // TOP layer, so append in reverse. The src stays first (invisible baseline).
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i];
      if (L.visible === false || L.paint === 'none') continue;
      const clone = src.cloneNode(true) as SVGElement;
      clone.removeAttribute('id');
      clone.removeAttribute('data-ap-src');
      clone.removeAttribute('data-name');
      // Object-level effects/clip belong to the wrapper, not each layer.
      for (const a of ['clip-path', 'filter', 'data-fx-blur', 'data-fx-shadow', 'style']) clone.removeAttribute(a);
      clone.setAttribute('data-ap', L.t);
      if (L.t === 'fill') {
        clone.setAttribute('fill', L.paint);
        clone.setAttribute('fill-opacity', String(L.opacity));
        clone.setAttribute('stroke', 'none');
        clone.removeAttribute('stroke-width');
      } else {
        clone.setAttribute('fill', 'none');
        clone.setAttribute('stroke', L.paint);
        clone.setAttribute('stroke-width', String(L.width ?? 1));
        clone.setAttribute('stroke-opacity', String(L.opacity));
      }
      if (L.blend) clone.style.setProperty('mix-blend-mode', L.blend);
      wrapperEl.appendChild(clone);
    }
    wrapperEl.insertBefore(src, wrapperEl.firstChild);

    // Representative single paint on the wrapper (inert — clones override — but
    // read by the Properties panel / export / eyedropper).
    const topFill = layers.find(l => l.t === 'fill' && l.visible !== false && l.paint !== 'none');
    const topStroke = layers.find(l => l.t === 'stroke' && l.visible !== false && l.paint !== 'none');
    wrapperEl.setAttribute('fill', topFill?.paint ?? 'none');
    if (topStroke) {
      wrapperEl.setAttribute('stroke', topStroke.paint);
      wrapperEl.setAttribute('stroke-width', String(topStroke.width ?? 1));
    } else {
      wrapperEl.setAttribute('stroke', 'none');
      wrapperEl.removeAttribute('stroke-width');
    }
  }

  /** Promote a plain element into a `<g data-appearance>` wrapper in place. */
  private wrap(shape: ShapeData, layers: AppearanceLayer[]): SVGElement {
    const el = shape.element;
    const g = document.createElementNS(SVG, 'g');
    g.id = el.id;
    g.setAttribute('data-appearance', JSON.stringify(layers));
    // Object-level attributes move to the wrapper (transform positions the whole
    // stack; effects/clip/name/lock/opacity apply to it as a unit).
    for (const a of CARRY_ATTRS) {
      const v = el.getAttribute(a);
      if (v != null) { g.setAttribute(a, v); el.removeAttribute(a); }
    }
    if (el.style.mixBlendMode) { g.style.mixBlendMode = el.style.mixBlendMode; el.style.removeProperty('mix-blend-mode'); }
    if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');

    el.removeAttribute('id');
    el.setAttribute('data-ap-src', '');
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', 'none');

    el.replaceWith(g); // takes el's slot (preserves parent/position, incl. nested frames)
    g.appendChild(el);
    this.regenerate(g);
    if (g.hasAttribute('data-fx-blur') || g.hasAttribute('data-fx-shadow')) this.host.applyEffectFilter(g);
    return g;
  }

  /** Collapse a wrapper back to its plain source element (trivial stack). */
  private unwrap(wrapperEl: SVGElement, layers: AppearanceLayer[]): SVGElement | null {
    const src = wrapperEl.querySelector(':scope > [data-ap-src]') as SVGElement | null;
    if (!src) return null;
    wrapperEl.querySelectorAll(':scope > [data-ap]').forEach(n => n.remove());
    src.setAttribute('id', wrapperEl.id);
    src.removeAttribute('data-ap-src');
    for (const a of CARRY_ATTRS) {
      const v = wrapperEl.getAttribute(a);
      if (v != null) src.setAttribute(a, v);
    }
    if (wrapperEl.style.mixBlendMode) src.style.mixBlendMode = wrapperEl.style.mixBlendMode;
    this.applyTrivialToNative(src, layers);
    wrapperEl.replaceWith(src);
    if (src.hasAttribute('data-fx-blur') || src.hasAttribute('data-fx-shadow')) this.host.applyEffectFilter(src);
    return src;
  }

  /**
   * The Appearance stack for an object (TOP layer first). For a plain element this
   * is synthesized from its native fill/stroke so the panel can display and extend
   * it; for a wrapped object it's the stored stack.
   */
  get(id: string): AppearanceLayer[] {
    const shape = this.host.findShape(id);
    if (!shape) return [];
    if (shape.type === 'appearance') return this.parse(shape.element);
    const el = shape.element;
    const layers: AppearanceLayer[] = [];
    const stroke = el.getAttribute('stroke');
    if (stroke && stroke !== 'none') {
      layers.push({
        t: 'stroke', paint: stroke,
        width: parseFloat(el.getAttribute('stroke-width') ?? '1') || 1,
        opacity: parseFloat(el.getAttribute('stroke-opacity') ?? '1'),
      });
    }
    const fill = el.getAttribute('fill');
    if (fill && fill !== 'none') {
      layers.push({ t: 'fill', paint: fill, opacity: parseFloat(el.getAttribute('fill-opacity') ?? '1') });
    }
    return layers;
  }

  /**
   * Replace an object's Appearance stack (TOP layer first). Collapses to a plain
   * native element when the stack is trivial (≤1 fill, ≤1 stroke, no blend),
   * otherwise wraps/updates a `<g data-appearance>`. One undo step.
   */
  set(id: string, layers: AppearanceLayer[], record = true): void {
    const shape = this.host.findShape(id);
    if (!shape) return;
    const trivial = this.isTrivial(layers);
    if (shape.type === 'appearance') {
      if (trivial) this.unwrap(shape.element, layers);
      else { shape.element.setAttribute('data-appearance', JSON.stringify(layers)); this.regenerate(shape.element); }
    } else {
      if (trivial) this.applyTrivialToNative(shape.element, layers);
      else this.wrap(shape, layers);
    }
    this.host.rebuild();
    this.host.setSelection([id]);
    if (record) this.host.saveHistory();
    this.host.onChange();
  }
}
