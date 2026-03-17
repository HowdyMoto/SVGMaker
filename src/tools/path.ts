import { BaseTool } from './base';
import type { Point } from '../core/types';

interface PathNode {
  point: Point;
  controlIn?: Point;
  controlOut?: Point;
}

export class PathTool extends BaseTool {
  name = 'path';
  private nodes: PathNode[] = [];
  private previewEl: SVGPathElement | null = null;
  private guidesLayer: Element | null = null;
  private dotEls: SVGElement[] = [];
  private isDragging = false;
  private currentNode: PathNode | null = null;

  activate(): void { this.nodes = []; this.cleanup(); }
  deactivate(): void { this.finishPath(); }

  onMouseDown(pt: Point, e: MouseEvent): void {
    if (e.detail === 2) { this.finishPath(); return; }
    this.isDragging = true;
    const node: PathNode = { point: { ...pt } };
    this.currentNode = node;
    this.nodes.push(node);

    if (!this.guidesLayer) this.guidesLayer = this.svgCanvas.querySelector('#guides-layer')!;
    const dot = document.createElementNS(this.NS, 'circle') as SVGCircleElement;
    dot.setAttribute('cx', String(pt.x));
    dot.setAttribute('cy', String(pt.y));
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', '#20a0ff');
    dot.setAttribute('stroke', 'white');
    dot.setAttribute('stroke-width', '1');
    this.guidesLayer.appendChild(dot);
    this.dotEls.push(dot);
  }

  onMouseMove(pt: Point, _e: MouseEvent): void {
    if (this.isDragging && this.currentNode) {
      const dx = pt.x - this.currentNode.point.x;
      const dy = pt.y - this.currentNode.point.y;
      this.currentNode.controlOut = { x: this.currentNode.point.x + dx, y: this.currentNode.point.y + dy };
      this.currentNode.controlIn = { x: this.currentNode.point.x - dx, y: this.currentNode.point.y - dy };
    }
    if (this.nodes.length > 0) this.updatePreview(pt);
  }

  onMouseUp(_pt: Point, _e: MouseEvent): void {
    this.isDragging = false;
    this.currentNode = null;
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === 'Escape') this.finishPath();
  }

  private buildPathD(nodes: PathNode[], trailingPt?: Point): string {
    if (nodes.length === 0) return '';
    let d = `M ${nodes[0].point.x} ${nodes[0].point.y}`;
    for (let i = 1; i < nodes.length; i++) {
      const prev = nodes[i - 1];
      const curr = nodes[i];
      if (prev.controlOut || curr.controlIn) {
        const cp1 = prev.controlOut ?? prev.point;
        const cp2 = curr.controlIn ?? curr.point;
        d += ` C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${curr.point.x} ${curr.point.y}`;
      } else {
        d += ` L ${curr.point.x} ${curr.point.y}`;
      }
    }
    if (trailingPt && nodes.length > 0) {
      const last = nodes[nodes.length - 1];
      if (last.controlOut) {
        d += ` C ${last.controlOut.x} ${last.controlOut.y}, ${trailingPt.x} ${trailingPt.y}, ${trailingPt.x} ${trailingPt.y}`;
      } else {
        d += ` L ${trailingPt.x} ${trailingPt.y}`;
      }
    }
    return d;
  }

  private updatePreview(currentPt: Point): void {
    if (!this.guidesLayer) this.guidesLayer = this.svgCanvas.querySelector('#guides-layer')!;
    if (!this.previewEl) {
      this.previewEl = document.createElementNS(this.NS, 'path') as SVGPathElement;
      this.previewEl.setAttribute('fill', 'none');
      this.previewEl.setAttribute('stroke', '#20a0ff');
      this.previewEl.setAttribute('stroke-width', '1.5');
      this.previewEl.setAttribute('stroke-dasharray', '5,5');
      this.guidesLayer.appendChild(this.previewEl);
    }
    this.previewEl.setAttribute('d', this.buildPathD(this.nodes, this.isDragging ? undefined : currentPt));
  }

  private finishPath(): void {
    this.cleanup();
    if (this.nodes.length < 2) { this.nodes = []; return; }

    const el = document.createElementNS(this.NS, 'path') as SVGPathElement;
    const id = this.state.nextId();
    el.id = id;
    el.setAttribute('d', this.buildPathD(this.nodes));
    el.setAttribute('fill', this.state.fillNone ? 'none' : this.state.defaultStyle.fill);
    el.setAttribute('stroke', this.state.strokeNone ? 'none' : this.state.defaultStyle.stroke);
    el.setAttribute('stroke-width', String(this.state.defaultStyle.strokeWidth));
    if (this.state.defaultStyle.opacity !== 1) el.setAttribute('opacity', String(this.state.defaultStyle.opacity));

    const name = `Path ${id.replace('shape-', '')}`;
    el.setAttribute('data-name', name);

    this.state.addShape({
      id, type: 'path', element: el, name,
      style: { ...this.state.defaultStyle, fill: this.state.fillNone ? 'none' : this.state.defaultStyle.fill, stroke: this.state.strokeNone ? 'none' : this.state.defaultStyle.stroke },
      visible: true, locked: false,
    });
    this.nodes = [];
  }

  private cleanup(): void {
    if (this.previewEl) { this.previewEl.remove(); this.previewEl = null; }
    for (const dot of this.dotEls) dot.remove();
    this.dotEls = [];
  }
}
