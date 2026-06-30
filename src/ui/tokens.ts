// ---------------------------------------------------------------------------
// Design tokens for the TypeScript / canvas layer.
//
// The CSS custom properties in style.css are the source of truth for chrome
// (panels, menus, buttons). But a lot of the editor's visuals are SVG overlay
// elements created in TS — selection handles, marquees, tool previews, artboard
// chrome — whose colors are written as presentation attributes and so can't read
// a CSS variable. Those values used to be hardcoded hex literals scattered across
// the tools/ and ui/ files (the selection blue alone appeared 22× in 8 files,
// and had drifted from the CSS accent). This module is their single home.
//
// Keep in sync with style.css where a value lives in both worlds.
// ---------------------------------------------------------------------------

export const tokens = {
  /**
   * On-canvas selection / active-overlay accent: selection handles & marquees,
   * pen/polyline previews, the selected-artboard border, rotation widgets.
   * This is the brighter on-canvas blue — intentionally distinct from the UI
   * chrome accent (`--ai-accent` in CSS), but defined once here so the overlay
   * layer stays consistent and themeable.
   */
  selectionAccent: '#20a0ff',
} as const;
