// ---------------------------------------------------------------------------
// Layer operations — the Layers-panel verbs: show/hide, lock/unlock, z-order
// (up/down/front/back), drag-reorder & drag-to-group, and duplicate (incl.
// Figma-style step-and-repeat).
//
// These manipulate the shape tree, so — unlike the self-contained feature
// collaborators (effects/markers/appearance/width/pathfinder) — this one leans on
// several AppState primitives, surfaced through LayerHost. The step-and-repeat
// state (stepOffset / lastDuplicateIds) lives here since only these methods use it.
// ---------------------------------------------------------------------------

import type { ShapeData } from './types';

export interface LayerHost {
  getShapes(): ShapeData[];
  setShapes(shapes: ShapeData[]): void;
  getSelectedIds(): string[];
  setSelection(ids: string[]): void;
  getDrawingLayer(): SVGGElement;
  findShape(id: string): ShapeData | null;
  nextId(): string;
  offsetElement(el: SVGElement, dx: number, dy: number): void;
  reIdGroupChildren(el: SVGElement): void;
  rebuild(): void;
  saveHistory(): void;
  onChange(): void;
}

export class LayerManager {
  private host: LayerHost;
  // Figma-style step-and-repeat: the offset a fresh duplicate is nudged by, so
  // repeating ⌘D keeps applying it. Only these methods touch it.
  private stepOffset: { dx: number; dy: number } | null = null;
  private lastDuplicateIds: string[] = [];

  constructor(host: LayerHost) { this.host = host; }

  toggleVisibility(id: string): void {
    const shape = this.host.findShape(id);
    if (!shape) return;
    shape.visible = !shape.visible;
    (shape.element as SVGElement).style.display = shape.visible ? '' : 'none';
    this.host.saveHistory();
    this.host.onChange();
  }

  toggleLock(id: string): void {
    const shape = this.host.findShape(id);
    if (!shape) return;
    shape.locked = !shape.locked;
    // Mirror onto the element so the lock survives history (which snapshots the
    // drawing layer's markup) and round-trips through rebuildShapesFromDOM.
    if (shape.locked) shape.element.setAttribute('data-locked', 'true');
    else shape.element.removeAttribute('data-locked');
    this.host.saveHistory();
    this.host.onChange();
  }

  /** Make every top-level shape visible again. */
  showAll(): void {
    for (const s of this.host.getShapes()) {
      s.visible = true;
      (s.element as SVGElement).style.display = '';
    }
    this.host.saveHistory();
    this.host.onChange();
  }

  /** Unlock every top-level shape. */
  unlockAll(): void {
    for (const s of this.host.getShapes()) {
      s.locked = false;
      s.element.removeAttribute('data-locked');
    }
    this.host.saveHistory();
    this.host.onChange();
  }

  moveShapeUp(id: string): void {
    const shapes = this.host.getShapes();
    const idx = shapes.findIndex(s => s.id === id);
    if (idx < shapes.length - 1) {
      const shape = shapes[idx];
      const nextShape = shapes[idx + 1];
      shapes[idx] = nextShape;
      shapes[idx + 1] = shape;
      this.host.getDrawingLayer().insertBefore(nextShape.element, shape.element);
      this.host.saveHistory();
      this.host.onChange();
    }
  }

  moveShapeDown(id: string): void {
    const shapes = this.host.getShapes();
    const idx = shapes.findIndex(s => s.id === id);
    if (idx > 0) {
      const shape = shapes[idx];
      const prevShape = shapes[idx - 1];
      shapes[idx] = prevShape;
      shapes[idx - 1] = shape;
      this.host.getDrawingLayer().insertBefore(shape.element, prevShape.element);
      this.host.saveHistory();
      this.host.onChange();
    }
  }

  /**
   * Drag-and-drop reorder/reparent from the Layers panel.
   *
   * The Layers panel lists shapes top-to-bottom in REVERSE paint order (top of the
   * list = top of the z-stack = last in the DOM). `position` is in that visual
   * order: 'before' = above the target in the panel (later in the DOM), 'after' =
   * below it, 'inside' = into the target group. We mutate the live DOM then rebuild
   * the model from it. When the parent changes, the transform is recomputed so the
   * element keeps its on-screen position.
   */
  moveShape(draggedId: string, targetId: string, position: 'before' | 'after' | 'inside'): boolean {
    if (draggedId === targetId) return false;
    const dragged = this.host.findShape(draggedId);
    const target = this.host.findShape(targetId);
    if (!dragged || !target) return false;

    const dEl = dragged.element;
    const tEl = target.element;
    // Never drop a group into its own subtree.
    if (dEl === tEl || dEl.contains(tEl)) return false;

    const oldParent = dEl.parentNode;
    const oldScreen = (dEl as unknown as SVGGraphicsElement).getScreenCTM();

    if (position === 'inside') {
      if (target.type !== 'group') return false;
      tEl.appendChild(dEl); // top of the group's stack
    } else {
      const parent = tEl.parentNode;
      if (!parent) return false;
      // Panel order is reversed vs. the DOM, so 'before' goes after the target.
      parent.insertBefore(dEl, position === 'before' ? tEl.nextSibling : tEl);
    }

    // Preserve on-screen position when the parent changed (reparent).
    const newParent = dEl.parentNode;
    if (newParent !== oldParent && oldScreen) {
      const pScreen = (newParent as unknown as SVGGraphicsElement).getScreenCTM?.();
      if (pScreen) {
        const m = pScreen.inverse().multiply(oldScreen);
        const r = (v: number) => Math.round(v * 1e6) / 1e6;
        dEl.setAttribute('transform', `matrix(${r(m.a)} ${r(m.b)} ${r(m.c)} ${r(m.d)} ${r(m.e)} ${r(m.f)})`);
      }
    }

    this.host.rebuild();
    this.host.setSelection([draggedId]);
    this.host.saveHistory();
    this.host.onChange();
    return true;
  }

  /**
   * Wrap `targetId` and `draggedId` in a NEW group at the target's position/parent
   * (dragging one layer directly onto another). Both keep their on-screen position.
   */
  groupShapes(draggedId: string, targetId: string): boolean {
    if (draggedId === targetId) return false;
    const dragged = this.host.findShape(draggedId);
    const target = this.host.findShape(targetId);
    if (!dragged || !target) return false;

    const dEl = dragged.element;
    const tEl = target.element;
    if (dEl === tEl || dEl.contains(tEl) || tEl.contains(dEl)) return false;
    const parent = tEl.parentNode;
    if (!parent) return false;

    const dOldParent = dEl.parentNode;
    const dOldScreen = (dEl as unknown as SVGGraphicsElement).getScreenCTM();

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const id = this.host.nextId();
    g.id = id;
    g.setAttribute('data-name', `Group ${id.replace('shape-', '#')}`);
    parent.insertBefore(g, tEl); // take the target's slot in the stack
    g.appendChild(tEl);          // target on the bottom
    g.appendChild(dEl);          // dragged on top

    // The dragged element's parent changed — compensate so it doesn't jump.
    if (dOldParent !== g && dOldScreen) {
      const pScreen = (g as unknown as SVGGraphicsElement).getScreenCTM?.();
      if (pScreen) {
        const m = pScreen.inverse().multiply(dOldScreen);
        const r = (v: number) => Math.round(v * 1e6) / 1e6;
        dEl.setAttribute('transform', `matrix(${r(m.a)} ${r(m.b)} ${r(m.c)} ${r(m.d)} ${r(m.e)} ${r(m.f)})`);
      }
    }

    this.host.rebuild();
    this.host.setSelection([id]);
    this.host.saveHistory();
    this.host.onChange();
    return true;
  }

  /** Re-append top-level shape elements so DOM paint order matches the model. */
  private syncDomOrder(): void {
    const layer = this.host.getDrawingLayer();
    for (const s of this.host.getShapes()) layer.appendChild(s.element);
  }

  /** Move the selected top-level shapes to the top of the z-order. */
  bringToFront(): void {
    const ids = new Set(this.host.getSelectedIds());
    const shapes = this.host.getShapes();
    const selected = shapes.filter(s => ids.has(s.id));
    if (selected.length === 0) return;
    const rest = shapes.filter(s => !ids.has(s.id));
    this.host.setShapes([...rest, ...selected]);
    this.syncDomOrder();
    this.host.saveHistory();
    this.host.onChange();
  }

  /** Move the selected top-level shapes to the bottom of the z-order. */
  sendToBack(): void {
    const ids = new Set(this.host.getSelectedIds());
    const shapes = this.host.getShapes();
    const selected = shapes.filter(s => ids.has(s.id));
    if (selected.length === 0) return;
    const rest = shapes.filter(s => !ids.has(s.id));
    this.host.setShapes([...selected, ...rest]);
    this.syncDomOrder();
    this.host.saveHistory();
    this.host.onChange();
  }

  duplicateShape(id: string): void {
    const newId = this.cloneShapeById(id);
    if (!newId) return;
    this.host.rebuild(); // clone was inserted into the DOM (maybe nested)
    this.host.setSelection([newId]);
    this.host.saveHistory();
    this.host.onChange();
  }

  /**
   * Duplicate the selection in one undo step, Figma-style "step and repeat": the
   * copy is offset by `stepOffset`. After you nudge a fresh duplicate into place
   * (recorded via notifyMovedSelection), repeating ⌘D keeps applying that offset.
   */
  duplicateSelected(): void {
    const ids = [...this.host.getSelectedIds()];
    if (ids.length === 0) return;
    const off = this.stepOffset ?? { dx: 10, dy: 10 };
    const newIds: string[] = [];
    for (const id of ids) {
      const newId = this.cloneShapeById(id, off.dx, off.dy);
      if (newId) newIds.push(newId);
    }
    if (newIds.length === 0) return;
    this.host.rebuild(); // clones inserted into the DOM (maybe nested)
    this.host.setSelection(newIds);
    this.lastDuplicateIds = [...newIds];
    this.stepOffset = off;
    this.host.saveHistory();
    this.host.onChange();
  }

  /**
   * Told by the Select tool when a drag-move finishes. If it moved exactly the
   * shapes produced by the last duplicate, that delta becomes the step-and-repeat
   * offset; any other move breaks the chain so the next ⌘D uses the default.
   */
  notifyMovedSelection(dx: number, dy: number): void {
    const moved = [...this.host.getSelectedIds()].sort().join(',');
    const lastDup = [...this.lastDuplicateIds].sort().join(',');
    if (lastDup && moved === lastDup && (dx !== 0 || dy !== 0)) {
      this.stepOffset = { dx, dy };
    } else {
      this.lastDuplicateIds = [];
      this.stepOffset = null;
    }
  }

  /**
   * Clone a shape into its own parent offset by (dx,dy), returning the new id. Does
   * NOT record history / select / notify — callers batch those so a multi-duplicate
   * is one undo step.
   */
  private cloneShapeById(id: string, dx = 10, dy = 10): string | null {
    const shape = this.host.findShape(id); // resolve anywhere in the tree (incl. frames)
    if (!shape) return null;
    const newEl = shape.element.cloneNode(true) as SVGElement;
    const newId = this.host.nextId();
    newEl.id = newId;
    // Re-id descendants so a duplicated container doesn't share child ids with the
    // original (which corrupts findShape / idCounter after a history rebuild).
    this.host.reIdGroupChildren(newEl);
    this.host.offsetElement(newEl, dx, dy);
    newEl.setAttribute('data-name', `${shape.type} ${newId.replace('shape-', '#')}`);
    const parent = (shape.element.parentElement as SVGElement | null) ?? this.host.getDrawingLayer();
    parent.insertBefore(newEl, shape.element.nextSibling);
    return newId;
  }
}
