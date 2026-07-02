/**
 * Object-level attributes that move onto a wrapper `<g>` when a shape is promoted
 * into an appearance / variable-width wrapper (and move back when it collapses).
 * Shared by AppearanceManager and WidthStrokeManager — the two "wrapper-cache leaf"
 * subsystems — so the carry set stays identical between them.
 */
export const CARRY_ATTRS = [
  'transform', 'clip-path', 'filter', 'data-fx-blur', 'data-fx-shadow',
  'data-locked', 'data-name', 'opacity', 'data-rotation',
];
