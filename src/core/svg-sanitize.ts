/**
 * Security sanitization for untrusted SVG entering the live DOM.
 *
 * SVGMaker opens arbitrary `.svg` / `.svgmaker` files and pastes SVG from the
 * system clipboard. That content is injected into the live document (via
 * `innerHTML` and `importNode` + `appendChild`), so it must be treated as
 * untrusted: a crafted file must not be able to run script in our origin or
 * silently phone home.
 *
 * Note: assigning markup through `innerHTML` does NOT run `<script>`, but it
 * DOES wire up inline event-handler attributes (`onload`, `onerror`, `onclick`,
 * SMIL `onbegin`, …) — e.g. `<image href="x" onerror="…">` fires with no user
 * interaction. We therefore strip:
 *   - every `on*` event-handler attribute,
 *   - `href` / `xlink:href` whose scheme isn't safe (blocks `javascript:` and
 *     external `http(s):` references used for tracking/exfiltration),
 *   - `url(...)` / `expression(...)` / `javascript:` inside inline `style`,
 *   - whole disallowed elements (`<script>`, `<foreignObject>`, `<a>`, SMIL
 *     animation, `<iframe>`, …).
 *
 * This is a hardening allow-list, not a general HTML sanitizer; it runs on the
 * SVG subtrees SVGMaker actually imports.
 */

import { SVG_NS_DECLS } from './svg-ns';

/**
 * Elements removed wholesale (with their subtree) on import. SVGMaker never
 * produces these and has no model for them, so dropping them loses no user data.
 * `<a>` and `<use>` are deliberately NOT here — they carry legitimate content
 * (wrapped shapes / symbol instances); their only risk is an unsafe `href`,
 * which the href allow-list below neutralizes while keeping the element.
 */
const BLOCKED_ELEMENTS = new Set([
  'script', 'foreignobject', 'iframe',
  'animate', 'animatetransform', 'animatemotion', 'animatecolor',
  'set', 'handler', 'listener',
]);

/** href schemes that are safe to keep on imported elements. */
function isSafeHref(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === '') return true;
  if (v.startsWith('#')) return true;                 // internal fragment ref
  if (v.startsWith('data:image/')) return true;       // embedded raster
  // Anything with an explicit scheme other than the above is rejected
  // (javascript:, vbscript:, http:, https:, file:, blob:, non-image data:, …).
  if (/^[a-z][a-z0-9+.-]*:/.test(v)) return false;
  return true;                                        // scheme-less relative ref
}

/** Strip active/external constructs from an inline `style` attribute value. */
function sanitizeStyle(css: string): string {
  return css
    .replace(/url\s*\(\s*['"]?\s*(?:https?:|javascript:|vbscript:|data:(?!image\/)|file:|blob:)[^)]*\)/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/javascript:/gi, '');
}

/**
 * Clean a `<style>` element's CSS text: the inline-style rules above plus
 * `@import` (which can pull in external stylesheets). The element is kept so
 * class-based styling on imported artwork still renders.
 */
function sanitizeStyleSheet(css: string): string {
  return sanitizeStyle(css).replace(/@import[^;]*;?/gi, '');
}

/**
 * Sanitize a parsed SVG subtree in place: removes blocked descendants and
 * unsafe attributes from `el` and everything under it.
 */
export function sanitizeSvgElement(el: Element): void {
  const toRemove: Element[] = [];

  const visit = (node: Element) => {
    if (BLOCKED_ELEMENTS.has(node.tagName.toLowerCase())) {
      toRemove.push(node);
      return; // drop the whole subtree; no need to descend
    }
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        node.removeAttribute(attr.name);
      } else if (name === 'href' || name === 'xlink:href' || name.endsWith(':href')) {
        if (!isSafeHref(attr.value)) node.removeAttribute(attr.name);
      } else if (name === 'style') {
        const cleaned = sanitizeStyle(attr.value);
        if (cleaned !== attr.value) node.setAttribute(attr.name, cleaned);
      }
    }
    // A <style> block's CSS text can carry @import / url(...) external refs.
    if (node.tagName.toLowerCase() === 'style' && node.textContent) {
      const cleaned = sanitizeStyleSheet(node.textContent);
      if (cleaned !== node.textContent) node.textContent = cleaned;
    }
    for (const child of Array.from(node.children)) visit(child);
  };

  visit(el);
  for (const n of toRemove) n.remove();
}

/**
 * Sanitize a raw SVG-fragment markup string (zero or more sibling elements),
 * returning safe markup suitable for `innerHTML`. Returns '' if the fragment
 * can't be parsed, so malformed input is dropped rather than injected raw.
 */
export function sanitizeSvgMarkup(markup: string): string {
  // Declare the standard prefixes (xlink/inkscape/sodipodi) so strict XML
  // parsing doesn't reject valid markup that uses e.g. xlink:href. DOMParser
  // produces an inert document, so this never fetches external resources.
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" ${SVG_NS_DECLS}>${markup}</svg>`,
    'image/svg+xml',
  );
  if (doc.getElementsByTagName('parsererror').length > 0) return '';
  const root = doc.documentElement;
  sanitizeSvgElement(root);
  const serializer = new XMLSerializer();
  let out = '';
  for (const child of Array.from(root.children)) out += serializer.serializeToString(child);
  return out;
}
