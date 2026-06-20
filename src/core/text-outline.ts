/**
 * Export-time text handling: convert <text> elements to vector <path> outlines
 * (universal compatibility, e.g. TraceCraft's single-path baking), or collect the
 * font files actually used so they can be embedded as @font-face in the output SVG.
 */
import { outlineString, loadFontDataUrl, resolveBundledFamily } from '../fonts';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface TextProcessResult {
  content: string;
  warnings: string[];
}

/** Parse a drawing-layer fragment into a detached <svg> we can mutate, then re-serialize children. */
function parseFragment(fragment: string): { root: SVGSVGElement; serialize: () => string } {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink">${fragment}</svg>`,
    'image/svg+xml',
  );
  const root = doc.documentElement as unknown as SVGSVGElement;
  const serializer = new XMLSerializer();
  const serialize = () =>
    Array.from(root.childNodes).map(n => serializer.serializeToString(n)).join('');
  return { root, serialize };
}

function numAttr(el: Element, name: string, fallback: number): number {
  const v = parseFloat(el.getAttribute(name) || '');
  return Number.isFinite(v) ? v : fallback;
}

/** Read a property from the element's presentation attribute or inline style. */
function readProp(el: Element, name: string): string | null {
  const style = el.getAttribute('style');
  if (style) {
    const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i').exec(style);
    if (m) return m[1].trim();
  }
  return el.getAttribute(name);
}

/**
 * Replace every <text> in the fragment with a filled <path> outline.
 * Single-line text only (matching the editor's text tool); honors text-anchor.
 */
export async function outlineText(fragment: string): Promise<TextProcessResult> {
  const { root, serialize } = parseFragment(fragment);
  const texts = Array.from(root.querySelectorAll('text'));
  if (texts.length === 0) return { content: fragment, warnings: [] };

  const warnings: string[] = [];

  for (const text of texts) {
    const content = text.textContent ?? '';
    if (!content.trim()) { text.remove(); continue; }

    const family = readProp(text, 'font-family') || 'Roboto';
    const requested = (family || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    const resolved = resolveBundledFamily(family);
    if (!resolved) {
      warnings.push(`Couldn't outline "${content}" — no bundled font for "${family}"; left as live text.`);
      continue;
    }
    if (resolved !== requested) {
      warnings.push(`Outlined "${content}" using "${resolved}" (no bundled "${requested}").`);
    }

    const fontSizeRaw = readProp(text, 'font-size') || '24';
    const fontSize = parseFloat(fontSizeRaw) || 24;
    const x = numAttr(text, 'x', 0);
    const y = numAttr(text, 'y', 0);
    const anchor = (readProp(text, 'text-anchor') || 'start').toLowerCase() as 'start' | 'middle' | 'end';

    const d = await outlineString(family, content, x, y, fontSize, anchor);
    if (d == null) {
      warnings.push(`Couldn't outline "${content}" — font "${family}" failed to load; left as live text.`);
      continue;
    }

    const path = root.ownerDocument!.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    // Carry over identity + paint. Text defaults to a black fill when unset, which a
    // bare <path> also does, so we only copy explicit values.
    for (const attr of ['id', 'data-name', 'class', 'transform', 'opacity',
      'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
      'stroke-opacity', 'stroke-linejoin', 'stroke-linecap', 'stroke-dasharray']) {
      const v = readProp(text, attr) ?? text.getAttribute(attr);
      if (v != null) path.setAttribute(attr, v);
    }
    text.replaceWith(path);
  }

  return { content: serialize(), warnings };
}

/**
 * Build a <style> block with @font-face rules embedding (as base64 WOFF) every bundled
 * family used by <text> in the fragment, so the exported SVG renders identically offline.
 * Returns '' if no embeddable text is present.
 */
export async function buildEmbeddedFontStyle(fragment: string): Promise<{ style: string; warnings: string[] }> {
  const { root } = parseFragment(fragment);
  const warnings: string[] = [];
  const families = new Set<string>();

  for (const text of Array.from(root.querySelectorAll('text'))) {
    if (!(text.textContent ?? '').trim()) continue;
    const family = readProp(text, 'font-family') || 'Roboto';
    const requested = family.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    // Only embed when the text references a bundled family by name — an @font-face
    // only applies if its name matches, so substituting a system font here is pointless.
    if (resolveBundledFamily(family) === requested) families.add(requested);
    else warnings.push(`Can't embed "${requested}" — not a bundled font; relying on the viewer's system fonts.`);
  }

  if (families.size === 0) return { style: '', warnings };

  const faces: string[] = [];
  for (const family of families) {
    const dataUrl = await loadFontDataUrl(family);
    if (!dataUrl) continue;
    faces.push(
      `@font-face{font-family:'${family}';font-style:normal;font-weight:400;` +
      `src:url(${dataUrl}) format('woff');}`,
    );
  }

  return { style: `<style>\n${faces.join('\n')}\n</style>`, warnings };
}
