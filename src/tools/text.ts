import { BaseTool } from './base';
import type { Point } from '../core/types';

const LINE_HEIGHT = 1.2; // multiple of font-size between baselines

/**
 * Type tool with an in-canvas editor: click to place a caret (or click an
 * existing text to edit it), type — including multiple lines with Enter — then
 * click away / Esc to commit. Multi-line text is rendered as a <text> with one
 * <tspan> per line (dy line spacing). Replaces the old single-line prompt().
 */
export class TextTool extends BaseTool {
  private editor: HTMLTextAreaElement | null = null;
  private editingEl: SVGTextElement | null = null; // non-null when editing existing text
  private anchor: Point = { x: 0, y: 0 };           // SVG-space top-left of the text block
  private cancelled = false;
  name = 'text';

  onMouseDown(pt: Point, e: MouseEvent): void {
    if (this.editor) { this.commit(); return; } // a click elsewhere commits the open editor
    e.preventDefault(); // don't let the mousedown steal focus back from the editor
    const textEl = (e.target as Element).closest?.('text') as SVGTextElement | null;
    if (textEl && textEl.id) this.editExisting(textEl);
    else this.openEditor(pt, null, '');
  }

  onDoubleClick(_pt: Point, e: MouseEvent): void {
    e.preventDefault();
    const textEl = (e.target as Element).closest?.('text') as SVGTextElement | null;
    if (textEl && textEl.id) this.editExisting(textEl);
  }

  onMouseMove(): void { /* editing happens in the overlay */ }
  onMouseUp(): void { /* editing happens in the overlay */ }
  deactivate(): void { if (this.editor) this.commit(); }

  // ---- Editing ----

  private editExisting(el: SVGTextElement): void {
    const x = parseFloat(el.getAttribute('x') ?? '0');
    const y = parseFloat(el.getAttribute('y') ?? '0');
    const fs = parseFloat(el.getAttribute('font-size') ?? '24');
    const lines = this.readLines(el);
    el.style.visibility = 'hidden'; // hide the live text while the overlay is up
    this.openEditor({ x, y: y - fs * 0.85 }, el, lines.join('\n'));
  }

  private openEditor(topLeft: Point, existing: SVGTextElement | null, value: string): void {
    this.editingEl = existing;
    this.anchor = topLeft;
    this.cancelled = false;

    const fs = existing
      ? parseFloat(existing.getAttribute('font-size') ?? '24')
      : (this.state.defaultStyle.fontSize ?? 24);
    const family = existing?.getAttribute('font-family') ?? this.state.defaultStyle.fontFamily ?? 'Arial';
    const weight = existing?.getAttribute('font-weight') ?? this.state.defaultStyle.fontWeight ?? 'normal';
    const italic = (existing?.getAttribute('font-style') ?? this.state.defaultStyle.fontStyle) === 'italic';
    const color = existing?.getAttribute('fill') ?? (this.state.fillNone ? '#000' : this.state.defaultStyle.fill);

    const zoom = this.canvas.getZoom();
    const scr = this.svgToScreen(topLeft.x, topLeft.y);

    const ta = document.createElement('textarea');
    ta.value = value;
    ta.spellcheck = false;
    ta.rows = 1;
    ta.style.cssText = `position:fixed; left:${scr.x}px; top:${scr.y}px; margin:0; padding:0;
      border:1px dashed #2d7ff9; outline:none; background:transparent; resize:none; overflow:hidden;
      white-space:pre; line-height:${LINE_HEIGHT}; z-index:10000;
      font-size:${fs * zoom}px; font-family:${family}; font-weight:${weight};
      font-style:${italic ? 'italic' : 'normal'}; color:${color}; caret-color:${color};`;
    document.body.appendChild(ta);
    this.editor = ta;
    this.autosize();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    ta.addEventListener('input', () => this.autosize());
    ta.addEventListener('blur', () => this.commit());
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); this.cancelled = true; ta.blur(); }
      // Enter inserts a newline (textarea default); ⌘/Ctrl+Enter commits.
      else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); ta.blur(); }
    });
  }

  private commit(): void {
    const ta = this.editor;
    if (!ta) return;
    this.editor = null;
    const raw = ta.value.replace(/\n+$/,''); // trim trailing blank lines
    const lines = raw.length ? raw.split('\n') : [];
    ta.remove();

    const existing = this.editingEl;
    this.editingEl = null;

    if (this.cancelled) { if (existing) existing.style.removeProperty('visibility'); return; }

    if (existing) {
      if (lines.length === 0) { this.state.removeShape(existing.id); return; }
      existing.style.removeProperty('visibility');
      const fs = parseFloat(existing.getAttribute('font-size') ?? '24');
      this.writeLines(existing, lines, parseFloat(existing.getAttribute('x') ?? '0'), fs);
      this.state.saveHistory();
      this.state.onChange_public();
      return;
    }

    if (lines.length === 0) return; // nothing typed → no shape
    this.createText(lines);
  }

  private createText(lines: string[]): void {
    const s = this.state;
    const fs = s.defaultStyle.fontSize ?? 24;
    const el = document.createElementNS(this.NS, 'text') as SVGTextElement;
    const id = s.nextId();
    el.id = id;
    el.setAttribute('x', String(this.anchor.x));
    el.setAttribute('y', String(this.anchor.y + fs * 0.85)); // baseline of the first line
    el.setAttribute('font-size', String(fs));
    el.setAttribute('font-family', s.defaultStyle.fontFamily ?? 'Arial');
    el.setAttribute('font-weight', s.defaultStyle.fontWeight ?? 'normal');
    el.setAttribute('font-style', s.defaultStyle.fontStyle ?? 'normal');
    el.setAttribute('fill', s.fillNone ? 'none' : s.defaultStyle.fill);
    if (!s.strokeNone && s.defaultStyle.strokeWidth > 0) {
      el.setAttribute('stroke', s.defaultStyle.stroke);
      el.setAttribute('stroke-width', String(s.defaultStyle.strokeWidth));
    }
    if (s.defaultStyle.opacity !== 1) el.setAttribute('opacity', String(s.defaultStyle.opacity));
    this.writeLines(el, lines, this.anchor.x, fs);
    const name = `Type ${id.replace('shape-', '')}`;
    el.setAttribute('data-name', name);
    s.addShape({
      id, type: 'text', element: el, name,
      style: { ...s.defaultStyle, fill: s.fillNone ? 'none' : s.defaultStyle.fill, stroke: s.strokeNone ? 'none' : s.defaultStyle.stroke },
      visible: true, locked: false,
    });
  }

  /** Read a text element's lines from its <tspan>s (or plain textContent). */
  private readLines(el: SVGTextElement): string[] {
    const tspans = el.querySelectorAll('tspan');
    if (tspans.length) return Array.from(tspans).map(t => t.textContent ?? '');
    return (el.textContent ?? '').split('\n');
  }

  /** Render lines into a text element: single line = textContent, else <tspan>s. */
  private writeLines(el: SVGTextElement, lines: string[], x: number, fontSize: number): void {
    while (el.firstChild) el.removeChild(el.firstChild);
    if (lines.length <= 1) { el.textContent = lines[0] ?? ''; return; }
    lines.forEach((line, i) => {
      const t = document.createElementNS(this.NS, 'tspan');
      t.setAttribute('x', String(x));
      t.setAttribute('dy', i === 0 ? '0' : String(fontSize * LINE_HEIGHT));
      t.textContent = line;
      el.appendChild(t);
    });
  }

  private autosize(): void {
    const ta = this.editor;
    if (!ta) return;
    ta.style.width = '0'; ta.style.height = '0';
    ta.style.width = `${ta.scrollWidth + 4}px`;
    ta.style.height = `${ta.scrollHeight}px`;
  }

  private svgToScreen(x: number, y: number): Point {
    const rect = this.svgCanvas.getBoundingClientRect();
    const vb = this.canvas.getViewBox();
    const zoom = this.canvas.getZoom();
    return { x: rect.left + (x - vb.x) * zoom, y: rect.top + (y - vb.y) * zoom };
  }
}
