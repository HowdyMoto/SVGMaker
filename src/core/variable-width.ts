/**
 * Variable-width stroke geometry: turn a centerline path + a width profile into a
 * single closed *filled* outline that renders as a stroke whose thickness varies
 * along its length (the Width tool). SVG has no native variable-width stroke, so we
 * sample the centerline, offset each sample by half the local width along the
 * normal, and stitch the left edge (forward) to the right edge (backward) into one
 * closed path — the standard approach for calligraphic / tapered strokes.
 */

/** A control point on the width profile: `w` is the FULL stroke width (user units)
 *  at normalized arc-length position `t` (0 = start, 1 = end). */
export interface WidthPoint {
  t: number;
  w: number;
}

// A single hidden <svg>/<path> reused for arc-length measurement, so we never
// touch the live document. getPointAtLength/getTotalLength work on a path mounted
// in any rendered SVG; a detached one is unreliable across engines, hence this.
let measurePath: SVGPathElement | null = null;
function measurer(): SVGPathElement {
  if (measurePath && measurePath.isConnected) return measurePath;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0;overflow:hidden;';
  const path = document.createElementNS(NS, 'path');
  svg.appendChild(path);
  document.body.appendChild(svg);
  measurePath = path;
  return path;
}

/** Full stroke width at normalized position `t`, piecewise-linear between the
 *  (sorted) profile points, clamped/held flat beyond the first & last. */
export function widthAt(points: WidthPoint[], t: number): number {
  if (points.length === 0) return 0;
  if (t <= points[0].t) return points[0].w;
  const last = points[points.length - 1];
  if (t >= last.t) return last.w;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (t <= b.t) {
      const span = b.t - a.t;
      const f = span <= 1e-9 ? 0 : (t - a.t) / span;
      return a.w + (b.w - a.w) * f;
    }
  }
  return last.w;
}

/**
 * Build the closed outline `d` for a centerline path with a width profile.
 * Returns '' when the centerline is empty or degenerate (no length). `points`
 * need not be sorted; endpoints are held flat. Round joins are approximated by
 * dense sampling. Sub-paths (multiple M commands) are handled per-segment.
 */
export function variableWidthOutline(centerlineD: string, points: WidthPoint[], baseWidth: number): string {
  if (!centerlineD.trim()) return '';
  const path = measurer();
  path.setAttribute('d', centerlineD);
  let total = 0;
  try { total = path.getTotalLength(); } catch { return ''; }
  if (!(total > 0)) return '';

  const sorted = [...points].sort((a, b) => a.t - b.t);
  const profile = sorted.length ? sorted : [{ t: 0, w: baseWidth }, { t: 1, w: baseWidth }];

  // Sample density scales with length but stays bounded; more samples where the
  // path is long so curves stay smooth without exploding the outline size.
  const samples = Math.max(24, Math.min(600, Math.round(total / 1.5)));
  const eps = total / (samples * 4);

  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const len = t * total;
    let c: DOMPoint, ahead: DOMPoint, behind: DOMPoint;
    try {
      c = path.getPointAtLength(len);
      ahead = path.getPointAtLength(Math.min(total, len + eps));
      behind = path.getPointAtLength(Math.max(0, len - eps));
    } catch { continue; }
    // Tangent from a central difference; fall back if it degenerates.
    let tx = ahead.x - behind.x, ty = ahead.y - behind.y;
    let tl = Math.hypot(tx, ty);
    if (tl < 1e-6) { tx = ahead.x - c.x; ty = ahead.y - c.y; tl = Math.hypot(tx, ty); }
    if (tl < 1e-6) { tx = 1; ty = 0; tl = 1; }
    tx /= tl; ty /= tl;
    // Left normal = rotate tangent +90°.
    const nx = -ty, ny = tx;
    const half = Math.max(0, widthAt(profile, t) / 2);
    left.push([c.x + nx * half, c.y + ny * half]);
    right.push([c.x - nx * half, c.y - ny * half]);
  }

  if (left.length < 2) return '';
  const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();
  const cmds: string[] = [];
  cmds.push(`M ${fmt(left[0][0])} ${fmt(left[0][1])}`);
  for (let i = 1; i < left.length; i++) cmds.push(`L ${fmt(left[i][0])} ${fmt(left[i][1])}`);
  for (let i = right.length - 1; i >= 0; i--) cmds.push(`L ${fmt(right[i][0])} ${fmt(right[i][1])}`);
  cmds.push('Z');
  return cmds.join(' ');
}

/**
 * Nearest point on a path to `pt` (path-local coordinates). Returns the normalized
 * arc-length position `t`, the closest point, the perpendicular distance, and the
 * unit left-normal there — everything the Width tool needs to hit-test a click and
 * turn a drag into a half-width. Null for an empty/zero-length path.
 */
export function nearestOnPath(
  centerlineD: string, pt: { x: number; y: number },
): { t: number; x: number; y: number; dist: number; nx: number; ny: number } | null {
  if (!centerlineD.trim()) return null;
  const path = measurer();
  path.setAttribute('d', centerlineD);
  let total = 0;
  try { total = path.getTotalLength(); } catch { return null; }
  if (!(total > 0)) return null;

  const samples = Math.max(48, Math.min(1000, Math.round(total)));
  let best = { t: 0, x: 0, y: 0, dist: Infinity };
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    let c: DOMPoint;
    try { c = path.getPointAtLength(t * total); } catch { continue; }
    const dist = Math.hypot(c.x - pt.x, c.y - pt.y);
    if (dist < best.dist) best = { t, x: c.x, y: c.y, dist };
  }
  // Normal at the best sample (central difference on the tangent).
  const eps = total / (samples * 2);
  const len = best.t * total;
  let tx = 1, ty = 0;
  try {
    const a = path.getPointAtLength(Math.min(total, len + eps));
    const b = path.getPointAtLength(Math.max(0, len - eps));
    tx = a.x - b.x; ty = a.y - b.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
  } catch { /* keep default */ }
  return { t: best.t, x: best.x, y: best.y, dist: best.dist, nx: -ty, ny: tx };
}

/** Point + unit left-normal at normalized arc-length position `t` on a path. */
export function pointAtParam(
  centerlineD: string, t: number,
): { x: number; y: number; nx: number; ny: number } | null {
  if (!centerlineD.trim()) return null;
  const path = measurer();
  path.setAttribute('d', centerlineD);
  let total = 0;
  try { total = path.getTotalLength(); } catch { return null; }
  if (!(total > 0)) return null;
  const len = Math.min(total, Math.max(0, t * total));
  try {
    const c = path.getPointAtLength(len);
    const eps = total / 400;
    const a = path.getPointAtLength(Math.min(total, len + eps));
    const b = path.getPointAtLength(Math.max(0, len - eps));
    let tx = a.x - b.x, ty = a.y - b.y;
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    return { x: c.x, y: c.y, nx: -ty, ny: tx };
  } catch { return null; }
}

/** Total arc length of a path in its own units (0 for empty/degenerate). */
export function pathLength(centerlineD: string): number {
  if (!centerlineD.trim()) return 0;
  const path = measurer();
  path.setAttribute('d', centerlineD);
  try { const l = path.getTotalLength(); return l > 0 ? l : 0; } catch { return 0; }
}

/** Named width-profile shapes (Illustrator's Width Profile dropdown), as functions
 *  of normalized position → width multiplier (× base width). Sampled into points. */
export const WIDTH_PROFILES: Record<string, (t: number) => number> = {
  uniform: () => 1,
  taperEnd: (t) => 1 - t,                       // full at start → 0 at end
  taperStart: (t) => t,                          // 0 at start → full at end
  leaf: (t) => Math.sin(Math.PI * t),            // 0 → full mid → 0 (both ends taper)
  bulge: (t) => 0.35 + 0.65 * Math.sin(Math.PI * t), // thin ends, fat middle
  waist: (t) => 1 - 0.7 * Math.sin(Math.PI * t), // fat ends, thin middle
};

/** Sample a named profile into width points at `steps` positions. */
export function profileToPoints(name: string, baseWidth: number, steps = 8): WidthPoint[] {
  const fn = WIDTH_PROFILES[name] ?? WIDTH_PROFILES.uniform;
  const pts: WidthPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({ t, w: Math.max(0, baseWidth * fn(t)) });
  }
  return pts;
}
