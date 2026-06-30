/**
 * The narrow surface AppState exposes to the subsystems carved out of it
 * (PaintRegistry today; Symbols / Selection / Clipboard to follow).
 *
 * Rather than hand each subsystem a reference to the whole AppState god object —
 * which would just relocate the coupling — they depend only on this interface:
 * the shared document infrastructure they genuinely need. It grows deliberately,
 * one member at a time, as more subsystems are extracted, so the real dependency
 * surface of each stays visible instead of being "all of AppState".
 */
export interface DocumentContext {
  /**
   * The lazily-created shared `<defs>` in the canvas SVG. Owned by AppState
   * because it's shared infrastructure — gradients, patterns, symbols, filters,
   * clip-paths and emulated stroke-alignment clips all live in this one element.
   */
  ensureDefs(): SVGDefsElement;

  /** Signal that the document changed so the app re-renders. */
  onChange(): void;
}
