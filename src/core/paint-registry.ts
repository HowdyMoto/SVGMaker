import type { GradientDef, GradientStop, PatternDef } from './types';
import type { DocumentContext } from './document-context';
import { sanitizeSvgElement } from './svg-sanitize';

const NS = 'http://www.w3.org/2000/svg';

/**
 * Owns the document's gradients and patterns: the tracked models surfaced in the
 * paint UI, their id counters, and the live `<defs>` elements they sync to.
 *
 * Extracted from AppState. It reaches the shared `<defs>` and the re-render hook
 * through {@link DocumentContext} rather than the whole AppState, so its real
 * dependency surface is just those two members. Symbols are NOT here — they're
 * coupled to the shape model (create-from-selection, detach-to-shapes) and stay
 * in AppState; this class is purely paint.
 */
export class PaintRegistry {
  gradients: GradientDef[] = [];
  patterns: PatternDef[] = [];
  private gradCounter = 0;
  private patternCounter = 0;
  private readonly ctx: DocumentContext;

  constructor(ctx: DocumentContext) {
    this.ctx = ctx;
  }

  /**
   * Reset every tracked paint model and counter. The live `<defs>` DOM is
   * cleared by the caller (AppState.clearDefs), which owns the shared element
   * and removes all non-editor children in one pass.
   */
  clear(): void {
    this.gradients = [];
    this.patterns = [];
    this.gradCounter = 0;
    this.patternCounter = 0;
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
    this.ctx.onChange();
  }

  removeGradient(id: string): void {
    this.gradients = this.gradients.filter(g => g.id !== id);
    const defs = this.ctx.ensureDefs();
    const el = defs.querySelector(`#${id}`);
    if (el) el.remove();
  }

  getGradientById(id: string): GradientDef | undefined {
    return this.gradients.find(g => g.id === id);
  }

  private syncGradientToDefs(grad: GradientDef): void {
    const defs = this.ctx.ensureDefs();

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

  /** Build a tracked GradientDef from an imported `<linearGradient>`/
   *  `<radialGradient>` and copy the sanitized element into the live <defs>. */
  importGradientElement(child: Element): void {
    const tag = child.tagName.toLowerCase();
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
    sanitizeSvgElement(imported);
    this.ctx.ensureDefs().appendChild(imported);
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
    this.ctx.onChange();
  }

  removePattern(id: string): void {
    this.patterns = this.patterns.filter(p => p.id !== id);
    const defs = this.ctx.ensureDefs();
    const el = defs.querySelector(`#${id}`);
    if (el) el.remove();
  }

  getPatternById(id: string): PatternDef | undefined {
    return this.patterns.find(p => p.id === id);
  }

  private syncPatternToDefs(pat: PatternDef): void {
    const defs = this.ctx.ensureDefs();

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
      this.buildPresetPatternContent(el, pat);
    }

    defs.appendChild(el);
  }

  private buildPresetPatternContent(el: SVGPatternElement, pat: PatternDef): void {
    const tw = pat.tileWidth * pat.scale + pat.spacing;
    const th = pat.tileHeight * pat.scale + pat.spacing;
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

  /** Track an imported `<pattern>`: copy the sanitized element into the live
   *  <defs> and record a minimal PatternDef so it round-trips. */
  importPatternElement(child: Element): void {
    const id = child.id || `pat-${++this.patternCounter}`;
    const m = id.match(/pat-(\d+)/);
    if (m) this.patternCounter = Math.max(this.patternCounter, parseInt(m[1]));

    // Copy element into our defs (sanitized: patterns can embed <image href>)
    const imported = document.importNode(child, true) as SVGElement;
    sanitizeSvgElement(imported);
    this.ctx.ensureDefs().appendChild(imported);

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
