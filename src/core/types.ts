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
  | 'eyedropper' | 'star' | 'polygon' | 'artboard' | 'image';

export interface ShapeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  strokeDasharray?: string;
  strokeLinecap?: string;
  strokeLinejoin?: string;
  rx?: number;
}

export interface ShapeData {
  id: string;
  type: 'rect' | 'ellipse' | 'line' | 'polyline' | 'path' | 'text' | 'polygon' | 'group' | 'image' | 'use';
  element: SVGElement;
  name: string;
  style: ShapeStyle;
  visible: boolean;
  locked: boolean;
  children?: ShapeData[];
  parentId?: string;
  rotation?: number;
  symbolId?: string; // for 'use' type, references a symbol in defs
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
