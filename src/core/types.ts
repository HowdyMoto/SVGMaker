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
  | 'eyedropper' | 'star' | 'polygon' | 'artboard';

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
  type: 'rect' | 'ellipse' | 'line' | 'polyline' | 'path' | 'text' | 'polygon';
  element: SVGElement;
  name: string;
  style: ShapeStyle;
  visible: boolean;
  locked: boolean;
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
