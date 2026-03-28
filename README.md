# SVGMaker

A browser-based SVG design editor inspired by Adobe Illustrator, built with TypeScript and Vite. Create, edit, and export vector graphics with a professional-grade interface — no server required.

![License](https://img.shields.io/badge/license-MIT-blue)

## Features

**Drawing Tools** — Rectangle, rounded rectangle, ellipse, polygon, star, line, polyline, freehand path (pen tool), text, and embedded images.

**Styling** — Fill and stroke colors, stroke weight/caps/joins/dash patterns, opacity, corner radius, linear & radial gradients, and pattern fills (dots, stripes, crosshatch, grid).

**Transforms** — Move, resize, rotate with visual handles or numeric input. Transform origin control via 9-point widget. Shift-snap rotation to 15-degree increments.

**Organization** — Layers panel with z-order management, groups (`<g>`) with nested group support, symbols (`<symbol>`/`<use>`) for reusable components, and multi-artboard support.

**Editing** — Undo/redo (100 levels), duplicate, copy/paste (including system clipboard), multi-select, alignment tools (left/center/right, top/middle/bottom), rulers and grid.

**Import/Export** — Import existing SVG files, export as SVG/PNG/JPG, save and load projects as JSON.

**Navigation** — Zoom (12.5%–600%), pan with hand tool or spacebar+drag, eyedropper for color sampling.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)

### Install & Run

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build for Production

```bash
npm run build
npm run preview   # preview the production build locally
```

Output goes to `dist/`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict mode) |
| Build | Vite 8 |
| Runtime | Browser (DOM/SVG API, no framework) |
| CSS | Vanilla CSS (Illustrator-themed dark UI) |

Zero runtime dependencies — the entire editor runs on native browser APIs.

## Project Structure

```
src/
├── main.ts              # App entry point & initialization
├── style.css            # UI styling
├── core/
│   ├── types.ts         # TypeScript interfaces & types
│   ├── state.ts         # Centralized state management
│   └── canvas.ts        # Canvas/viewport controller
├── tools/               # 16 drawing & interaction tools
│   ├── base.ts          # Base tool class
│   ├── select.ts        # Selection & transformation
│   ├── rect.ts          # Rectangle
│   ├── rounded-rect.ts  # Rounded rectangle
│   ├── ellipse.ts       # Circle/ellipse
│   ├── polygon-tool.ts  # Regular polygon
│   ├── star.ts          # Star
│   ├── line.ts          # Line segment
│   ├── polyline.ts      # Multi-point line
│   ├── path.ts          # Pen tool (freehand paths)
│   ├── text.ts          # Text creation & editing
│   ├── image.ts         # Image embedding
│   ├── artboard-tool.ts # Artboard creation
│   ├── hand.ts          # Pan tool
│   ├── zoom-tool.ts     # Zoom tool
│   └── eyedropper.ts    # Color picker tool
└── ui/                  # Panels & dialogs
    ├── menus.ts         # File/Edit/Object/View menus
    ├── properties.ts    # Properties panel
    ├── layers.ts        # Layers panel
    ├── color-picker.ts  # HSL/RGB color picker
    ├── symbols-panel.ts # Symbol library
    ├── artboards-panel.ts
    ├── export.ts        # SVG/PNG/JPG export
    ├── export-dialog.ts # Multi-artboard export
    ├── project-file.ts  # Save/load projects
    ├── align.ts         # Alignment tools
    ├── rulers.ts        # Canvas rulers
    ├── selection-overlay.ts
    └── artboard-renderer.ts
```

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full phased plan. Phases 1 and 2 (groups, transforms, symbols, images, gradients, patterns) are complete. Upcoming:

- **Phase 3** — Filters (blur, shadow, color effects), blend modes
- **Phase 4** — Clip paths, masks, markers/arrowheads
- **Phase 5** — Rich text, text on path, wrapped text
- **Phase 6** — SMIL animation, motion paths, CSS animation export
- **Phase 7** — Hyperlinks, accessibility, metadata
