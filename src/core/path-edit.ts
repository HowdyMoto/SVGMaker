/**
 * A live node-editing session for a single path element. Holds the parsed
 * {@link PathModel}, the current anchor selection, and the editing operations
 * the Pen / Direct-Selection tools drive. All coordinates here are in the
 * element's *local* space (the tools convert pointer coords before calling in).
 *
 * Lives on AppState so the tool (mutates), the overlay (renders) and the
 * Properties panel (reads/sets type) share one source of truth.
 */
import {
  parsePath, serializePath, setAnchorType, insertAnchorAt, deleteAnchor, inferType,
  type PathModel, type Anchor, type AnchorType,
} from './path-model';

export type HandleWhich = 'in' | 'out';

export interface AnchorRef { sp: number; i: number; }
export interface HandleHit extends AnchorRef { which: HandleWhich; }
export interface SegmentHit { sp: number; seg: number; t: number; }

const key = (sp: number, i: number) => `${sp}:${i}`;

export class PathEditSession {
  model: PathModel;
  /** Selected anchors as "sp:i" keys. */
  selected = new Set<string>();

  constructor(d: string) {
    this.model = parsePath(d);
  }

  commit(): string {
    return serializePath(this.model);
  }

  get isEmpty(): boolean {
    return this.model.subpaths.every(sp => sp.anchors.length === 0);
  }

  anchor(ref: AnchorRef): Anchor | undefined {
    return this.model.subpaths[ref.sp]?.anchors[ref.i];
  }

  // ---- selection ----

  isSelected(sp: number, i: number): boolean { return this.selected.has(key(sp, i)); }
  selectOnly(sp: number, i: number): void { this.selected.clear(); this.selected.add(key(sp, i)); }
  addSelect(sp: number, i: number): void { this.selected.add(key(sp, i)); }
  toggleSelect(sp: number, i: number): void {
    const k = key(sp, i);
    if (this.selected.has(k)) this.selected.delete(k); else this.selected.add(k);
  }
  clearSelection(): void { this.selected.clear(); }

  selectedRefs(): AnchorRef[] {
    return [...this.selected].map(k => {
      const [sp, i] = k.split(':').map(Number);
      return { sp, i };
    });
  }

  /** The single selected anchor's type, or null if 0 or mixed. */
  selectionType(): AnchorType | null {
    const refs = this.selectedRefs();
    if (refs.length === 0) return null;
    let t: AnchorType | null = null;
    for (const r of refs) {
      const a = this.anchor(r);
      if (!a) continue;
      if (t === null) t = a.type;
      else if (t !== a.type) return null;
    }
    return t;
  }

  // ---- editing ops ----

  /** Move an anchor and both its handles by (dx, dy). */
  moveAnchor(sp: number, i: number, dx: number, dy: number): void {
    const a = this.model.subpaths[sp]?.anchors[i];
    if (!a) return;
    a.x += dx; a.y += dy;
    if (a.inX !== undefined) { a.inX += dx; a.inY! += dy; }
    if (a.outX !== undefined) { a.outX += dx; a.outY! += dy; }
  }

  /** Move all currently-selected anchors by (dx, dy). */
  moveSelected(dx: number, dy: number): void {
    for (const r of this.selectedRefs()) this.moveAnchor(r.sp, r.i, dx, dy);
  }

  /**
   * Drag a control handle to (x, y). For smooth anchors the opposite handle is
   * mirrored (equal length, opposite direction). Alt breaks the link, demoting
   * the anchor to `broken`.
   */
  moveHandle(sp: number, i: number, which: HandleWhich, x: number, y: number, alt = false): void {
    const a = this.model.subpaths[sp]?.anchors[i];
    if (!a) return;
    if (which === 'in') { a.inX = x; a.inY = y; } else { a.outX = x; a.outY = y; }

    if (alt) { a.type = 'broken'; return; }

    if (a.type === 'smooth') {
      // Mirror the opposite handle: same distance, opposite direction.
      const hx = x - a.x, hy = y - a.y;
      if (which === 'in') {
        if (a.outX !== undefined) {
          const outLen = Math.hypot(a.outX - a.x, a.outY! - a.y) || Math.hypot(hx, hy);
          const m = Math.hypot(hx, hy) || 1;
          a.outX = a.x - (hx / m) * outLen; a.outY = a.y - (hy / m) * outLen;
        }
      } else {
        if (a.inX !== undefined) {
          const inLen = Math.hypot(a.x - a.inX, a.y - a.inY!) || Math.hypot(hx, hy);
          const m = Math.hypot(hx, hy) || 1;
          // Opposite side of the anchor (subtract), so the handles stay
          // collinear-opposite and the point reads as a smooth curve.
          a.inX = a.x - (hx / m) * inLen; a.inY = a.y - (hy / m) * inLen;
        }
      }
    } else {
      a.type = inferType(a);
    }
  }

  setSelectedType(type: AnchorType): void {
    for (const r of this.selectedRefs()) {
      const sp = this.model.subpaths[r.sp];
      if (sp) setAnchorType(sp, r.i, type);
    }
  }

  /** Delete selected anchors; prunes subpaths that fall below 2 anchors. Returns true if anything changed. */
  deleteSelected(): boolean {
    const refs = this.selectedRefs();
    if (refs.length === 0) return false;
    // Delete from highest index down so earlier indices stay valid.
    refs.sort((a, b) => (a.sp - b.sp) || (b.i - a.i));
    for (const r of refs) {
      const sp = this.model.subpaths[r.sp];
      if (sp) deleteAnchor(sp, r.i);
    }
    this.model.subpaths = this.model.subpaths.filter(sp => sp.anchors.length >= 2);
    this.selected.clear();
    return true;
  }

  insertAt(hit: SegmentHit): AnchorRef {
    const sp = this.model.subpaths[hit.sp];
    const newIndex = insertAnchorAt(sp, hit.seg, hit.t);
    return { sp: hit.sp, i: newIndex };
  }

  // ---- hit testing (local coords) ----

  hitHandle(px: number, py: number, tol: number): HandleHit | null {
    for (const r of this.selectedRefs()) {
      const a = this.anchor(r);
      if (!a) continue;
      if (a.outX !== undefined && Math.hypot(a.outX - px, a.outY! - py) <= tol) return { ...r, which: 'out' };
      if (a.inX !== undefined && Math.hypot(a.inX - px, a.inY! - py) <= tol) return { ...r, which: 'in' };
    }
    return null;
  }

  hitAnchor(px: number, py: number, tol: number): AnchorRef | null {
    for (let sp = 0; sp < this.model.subpaths.length; sp++) {
      const anchors = this.model.subpaths[sp].anchors;
      for (let i = 0; i < anchors.length; i++) {
        if (Math.hypot(anchors[i].x - px, anchors[i].y - py) <= tol) return { sp, i };
      }
    }
    return null;
  }

  /** Find the nearest segment within tol, sampling each cubic/line. */
  hitSegment(px: number, py: number, tol: number): SegmentHit | null {
    let best: SegmentHit | null = null;
    let bestDist = tol;
    const SAMPLES = 24;
    for (let sp = 0; sp < this.model.subpaths.length; sp++) {
      const path = this.model.subpaths[sp];
      const n = path.anchors.length;
      const segCount = path.closed ? n : n - 1;
      for (let seg = 0; seg < segCount; seg++) {
        const a = path.anchors[seg];
        const b = path.anchors[(seg + 1) % n];
        const p0 = a, p3 = b;
        const c1x = a.outX ?? a.x, c1y = a.outY ?? a.y;
        const c2x = b.inX ?? b.x, c2y = b.inY ?? b.y;
        for (let s = 0; s <= SAMPLES; s++) {
          const t = s / SAMPLES, u = 1 - t;
          const x = u * u * u * p0.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * p3.x;
          const y = u * u * u * p0.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * p3.y;
          const dist = Math.hypot(x - px, y - py);
          if (dist < bestDist) { bestDist = dist; best = { sp, seg, t }; }
        }
      }
    }
    return best;
  }
}
