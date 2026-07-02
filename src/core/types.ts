export interface Point {
  x: number;
  y: number;
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ToolName =
  | 'select' | 'directSelect' | 'rect' | 'roundedRect' | 'ellipse'
  | 'line' | 'polyline' | 'path' | 'text' | 'hand' | 'zoom'
  | 'eyedropper' | 'star' | 'polygon' | 'artboard' | 'image' | 'shapeBuilder' | 'width';

export interface ShapeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  fillOpacity?: number;   // 0–1, independent of object opacity
  strokeOpacity?: number; // 0–1, independent of object opacity
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  strokeDasharray?: string;
  strokeDashoffset?: number;
  strokeLinecap?: string;
  strokeLinejoin?: string;
  strokeMiterlimit?: number;
  /** Emulated stroke alignment. SVG has no native property, so inside/outside are
   *  rendered via clip-path + a doubled stroke-width (see stroke-align.ts). */
  strokeAlign?: 'center' | 'inside' | 'outside';
  /** vector-effect: non-scaling-stroke — keep stroke width constant under zoom/scale. */
  strokeNonScaling?: boolean;
  rx?: number;
}

export interface ShapeData {
  id: string;
  type: 'rect' | 'ellipse' | 'line' | 'polyline' | 'path' | 'text' | 'polygon' | 'group' | 'image' | 'use' | 'boolean' | 'frame' | 'appearance' | 'width';
  element: SVGElement;
  name: string;
  style: ShapeStyle;
  visible: boolean;
  locked: boolean;
  children?: ShapeData[];
  parentId?: string;
  rotation?: number;
  symbolId?: string; // for 'use' type, references a symbol in defs
  /** For 'boolean' (live compound shape): which Pathfinder op produced it. The
   *  `children` are the editable operands; a cached <path data-bool-result> child
   *  holds the computed geometry. See core/boolean.ts and AppState.createBoolean. */
  booleanOp?: 'unite' | 'subtract' | 'intersect' | 'exclude';
}

/**
 * One layer of an Appearance stack (Illustrator's Appearance panel): a fill or a
 * stroke painted over the object's geometry. An object with more than one fill or
 * stroke is stored as a `<g data-appearance>` wrapper whose child render-clones
 * are regenerated from this stack; see AppState.setAppearance. Array order is
 * TOP-first: layers[0] paints on top.
 */
export interface AppearanceLayer {
  t: 'fill' | 'stroke';
  paint: string;   // hex colour, gradient/pattern url(...), or 'none'
  opacity: number; // 0–1
  width?: number;  // stroke weight (stroke layers only)
  blend?: string;  // optional mix-blend-mode for this layer
  visible?: boolean; // eye toggle; undefined/true = shown
}

/** Drop-shadow parameters for an object effect (see AppState.setObjectShadow). */
export interface ObjectShadow {
  dx: number;
  dy: number;
  blur: number;
  color: string;
  opacity: number;
}

export interface SymbolDef {
  id: string;
  name: string;
  element: SVGSymbolElement;
}

export interface HistoryEntry {
  svgContent: string;
  selectedId: string | null;
  artboardsJson: string;
}

export interface Artboard {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
}

export type ExportFormat = 'svg' | 'png' | 'jpg';

// ---- Paint system (gradients & patterns) ----

export interface GradientStop {
  offset: number;  // 0–1
  color: string;   // hex
  opacity: number; // 0–1
}

export interface GradientDef {
  id: string;
  type: 'linear' | 'radial';
  stops: GradientStop[];
  // Linear-specific (objectBoundingBox coords, 0–1)
  x1?: number; y1?: number; x2?: number; y2?: number;
  // Radial-specific
  cx?: number; cy?: number; r?: number; fx?: number; fy?: number;
  spreadMethod?: 'pad' | 'reflect' | 'repeat';
}

export interface PatternDef {
  id: string;
  type: 'preset' | 'image';
  // Preset params
  preset?: 'dots' | 'stripes' | 'crosshatch' | 'grid';
  presetColor?: string;
  // Image params
  imageDataUrl?: string;
  // Shared
  scale: number;      // multiplier, 1 = natural size
  rotation: number;   // degrees
  spacing: number;    // px gap around tile
  tileWidth: number;
  tileHeight: number;
}
