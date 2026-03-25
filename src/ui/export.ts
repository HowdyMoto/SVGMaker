import type { AppState } from '../core/state';

export function exportSVG(state: AppState): void {
  const content = state.getDrawingLayerSVG();
  const ab = state.artboard;
  const svgString = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ab.width} ${ab.height}" width="${ab.width}" height="${ab.height}">
${state.getDefsBlock()}${content}
</svg>`;

  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'drawing.svg';
  a.click();
  URL.revokeObjectURL(url);
}

export function importSVG(state: AppState): void {
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  fileInput.click();
  fileInput.onchange = () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.importSVGContent(reader.result as string);
    };
    reader.readAsText(file);
    fileInput.value = '';
  };
}

export function exportPNG(state: AppState): void {
  const content = state.getDrawingLayerSVG();
  const ab = state.artboard;
  const svgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ab.width} ${ab.height}" width="${ab.width}" height="${ab.height}">${state.getDefsBlock()}<rect width="${ab.width}" height="${ab.height}" fill="white"/>${content}</svg>`;

  const img = new Image();
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = ab.width * 2;
    canvas.height = ab.height * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    canvas.toBlob((pngBlob) => {
      if (!pngBlob) return;
      const pngUrl = URL.createObjectURL(pngBlob);
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = 'drawing.png';
      a.click();
      URL.revokeObjectURL(pngUrl);
    }, 'image/png');
  };

  img.src = url;
}
