import type { AppState } from '../core/state';

const NS = 'http://www.w3.org/2000/svg';

/**
 * Renders all artboards as white rectangles on the pasteboard.
 * Called on every state change. Updates the SVG elements in the artboards layer.
 */
export function renderArtboards(state: AppState, svgCanvas: SVGSVGElement): void {
  // Get or create the artboards layer (just after pasteboard)
  let abLayer = svgCanvas.querySelector('#artboards-layer') as SVGGElement | null;
  if (!abLayer) {
    abLayer = document.createElementNS(NS, 'g') as SVGGElement;
    abLayer.id = 'artboards-layer';
    const pasteboard = svgCanvas.querySelector('#pasteboard');
    if (pasteboard && pasteboard.nextSibling) {
      svgCanvas.insertBefore(abLayer, pasteboard.nextSibling);
    } else {
      svgCanvas.appendChild(abLayer);
    }
  }
  abLayer.innerHTML = '';

  // Get or create artboard labels layer (after selection layer)
  let labelsLayer = svgCanvas.querySelector('#artboard-labels-layer') as SVGGElement | null;
  if (!labelsLayer) {
    labelsLayer = document.createElementNS(NS, 'g') as SVGGElement;
    labelsLayer.id = 'artboard-labels-layer';
    svgCanvas.appendChild(labelsLayer);
  }
  labelsLayer.innerHTML = '';

  // Get or create artboard handles layer (for artboard tool)
  let handlesLayer = svgCanvas.querySelector('#artboard-handles-layer') as SVGGElement | null;
  if (!handlesLayer) {
    handlesLayer = document.createElementNS(NS, 'g') as SVGGElement;
    handlesLayer.id = 'artboard-handles-layer';
    svgCanvas.appendChild(handlesLayer);
  }
  handlesLayer.innerHTML = '';

  const isArtboardTool = state.currentTool === 'artboard';
  const showGrid = document.getElementById('artboard-grid')?.style.display !== 'none';

  for (const ab of state.artboards) {
    const isActive = ab.id === state.activeArtboardId;
    const isSelected = ab.id === state.selectedArtboardId && isArtboardTool;

    // Artboard background — checkerboard for transparency or solid white
    if (state.showTransparency) {
      const checkBg = document.createElementNS(NS, 'rect');
      checkBg.setAttribute('x', String(ab.x));
      checkBg.setAttribute('y', String(ab.y));
      checkBg.setAttribute('width', String(ab.width));
      checkBg.setAttribute('height', String(ab.height));
      checkBg.setAttribute('fill', 'url(#transparency-check)');
      abLayer.appendChild(checkBg);
    } else {
      const bg = document.createElementNS(NS, 'rect');
      bg.setAttribute('x', String(ab.x));
      bg.setAttribute('y', String(ab.y));
      bg.setAttribute('width', String(ab.width));
      bg.setAttribute('height', String(ab.height));
      bg.setAttribute('fill', 'white');
      abLayer.appendChild(bg);
    }

    // Grid overlay if enabled
    if (showGrid) {
      const grid = document.createElementNS(NS, 'rect');
      grid.setAttribute('x', String(ab.x));
      grid.setAttribute('y', String(ab.y));
      grid.setAttribute('width', String(ab.width));
      grid.setAttribute('height', String(ab.height));
      grid.setAttribute('fill', 'url(#grid-large)');
      abLayer.appendChild(grid);
    }

    // Border
    const border = document.createElementNS(NS, 'rect');
    border.setAttribute('x', String(ab.x));
    border.setAttribute('y', String(ab.y));
    border.setAttribute('width', String(ab.width));
    border.setAttribute('height', String(ab.height));
    border.setAttribute('fill', 'none');
    border.setAttribute('stroke', isSelected ? '#20a0ff' : (isActive ? '#333' : '#666'));
    border.setAttribute('stroke-width', isSelected ? '2' : '0.5');
    border.setAttribute('pointer-events', 'none');
    abLayer.appendChild(border);

    // Artboard name label (above top-left corner)
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', String(ab.x));
    label.setAttribute('y', String(ab.y - 6));
    label.setAttribute('font-size', '11');
    label.setAttribute('font-family', 'Arial, sans-serif');
    label.setAttribute('fill', isActive ? '#ccc' : '#888');
    label.setAttribute('pointer-events', 'none');
    label.textContent = ab.name;
    labelsLayer.appendChild(label);

    // Resize handles if artboard tool is active and this artboard is selected
    if (isSelected) {
      const handleSize = 8;
      const handles = [
        { id: 'nw', cx: ab.x, cy: ab.y },
        { id: 'n', cx: ab.x + ab.width / 2, cy: ab.y },
        { id: 'ne', cx: ab.x + ab.width, cy: ab.y },
        { id: 'e', cx: ab.x + ab.width, cy: ab.y + ab.height / 2 },
        { id: 'se', cx: ab.x + ab.width, cy: ab.y + ab.height },
        { id: 's', cx: ab.x + ab.width / 2, cy: ab.y + ab.height },
        { id: 'sw', cx: ab.x, cy: ab.y + ab.height },
        { id: 'w', cx: ab.x, cy: ab.y + ab.height / 2 },
      ];
      const cursors: Record<string, string> = {
        nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
        se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
      };
      for (const h of handles) {
        const rect = document.createElementNS(NS, 'rect');
        rect.setAttribute('x', String(h.cx - handleSize / 2));
        rect.setAttribute('y', String(h.cy - handleSize / 2));
        rect.setAttribute('width', String(handleSize));
        rect.setAttribute('height', String(handleSize));
        rect.setAttribute('fill', 'white');
        rect.setAttribute('stroke', '#20a0ff');
        rect.setAttribute('stroke-width', '1');
        rect.setAttribute('data-ab-handle', h.id);
        rect.setAttribute('data-ab-id', ab.id);
        rect.setAttribute('style', `cursor: ${cursors[h.id]}`);
        handlesLayer.appendChild(rect);
      }
    }
  }
}
