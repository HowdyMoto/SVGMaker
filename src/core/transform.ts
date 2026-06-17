/**
 * Element transform helpers built on the SVG DOM's typed transform list
 * (SVGTransformList / SVGTransform) rather than regex on the `transform` string.
 *
 * The string approach only matched the exact `translate(x, y)` / `rotate(a, …)`
 * forms SVGMaker itself wrote, and silently mishandled anything else — an
 * imported `matrix(...)`, scientific notation, or a second transform in the
 * list. The typed API composes correctly regardless of what's already there.
 *
 * Canonical form written here: `translate(tx ty) rotate(deg cx cy)` — the
 * translate is outermost (a parent-space move) and the rotate is about the
 * element's local bbox centre, so a translated shape rotates about its own
 * centre instead of orbiting the origin.
 */

export function nudgeTranslate(el: SVGElement, dx: number, dy: number): void {
  const owner = el.ownerSVGElement;
  if (!owner) return;
  const list = (el as SVGGraphicsElement).transform.baseVal;
  const first = list.numberOfItems > 0 ? list.getItem(0) : null;
  if (first && first.type === SVGTransform.SVG_TRANSFORM_TRANSLATE) {
    // Merge into the existing outermost translate so drags don't accumulate items.
    const m = first.matrix;
    first.setTranslate(m.e + dx, m.f + dy);
  } else {
    const t = owner.createSVGTransform();
    t.setTranslate(dx, dy);
    list.insertItemBefore(t, 0);
  }
}

/** The element's rotation in degrees (first rotate item), or 0. */
export function getRotation(el: SVGElement): number {
  const list = (el as SVGGraphicsElement).transform?.baseVal;
  if (!list) return 0;
  for (let i = 0; i < list.numberOfItems; i++) {
    const item = list.getItem(i);
    if (item.type === SVGTransform.SVG_TRANSFORM_ROTATE) return item.angle;
  }
  return 0;
}

/**
 * Set the element's rotation about (cx, cy), preserving any other transforms
 * (e.g. a translate). deg === 0 removes rotation (and the attribute if nothing
 * else remains).
 */
export function setRotation(el: SVGElement, deg: number, cx: number, cy: number): void {
  const owner = el.ownerSVGElement;
  if (!owner) return;
  const list = (el as SVGGraphicsElement).transform.baseVal;
  for (let i = list.numberOfItems - 1; i >= 0; i--) {
    if (list.getItem(i).type === SVGTransform.SVG_TRANSFORM_ROTATE) list.removeItem(i);
  }
  if (deg !== 0) {
    const t = owner.createSVGTransform();
    t.setRotate(deg, cx, cy);
    list.appendItem(t); // after the translate, so the move stays in parent space
  }
  if (list.numberOfItems === 0) el.removeAttribute('transform');
}
