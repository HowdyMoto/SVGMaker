import type { CanvasController } from '../core/canvas';

export function drawRulers(canvas: CanvasController): void {
  drawHorizontalRuler(canvas);
  drawVerticalRuler(canvas);
}

function drawHorizontalRuler(canvas: CanvasController): void {
  const rulerEl = document.getElementById('ruler-h') as HTMLCanvasElement;
  if (!rulerEl || rulerEl.classList.contains('hidden')) return;

  const rect = rulerEl.getBoundingClientRect();
  rulerEl.width = rect.width * window.devicePixelRatio;
  rulerEl.height = rect.height * window.devicePixelRatio;

  const ctx = rulerEl.getContext('2d')!;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const vb = canvas.getViewBox();
  const zoom = canvas.getZoom();

  ctx.fillStyle = '#3c3c3c';
  ctx.fillRect(0, 0, rect.width, rect.height);

  ctx.fillStyle = '#999';
  ctx.strokeStyle = '#666';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';

  const step = getStep(zoom);
  const startX = Math.floor(vb.x / step) * step;

  for (let x = startX; x < vb.x + vb.w; x += step) {
    const screenX = (x - vb.x) * zoom;
    ctx.beginPath();
    ctx.moveTo(screenX, rect.height);
    const isMajor = Math.abs(x % (step * 5)) < 0.5;
    const tickH = isMajor ? 10 : 5;
    ctx.lineTo(screenX, rect.height - tickH);
    ctx.stroke();

    if (isMajor) {
      ctx.fillText(String(Math.round(x)), screenX, 10);
    }
  }
}

function drawVerticalRuler(canvas: CanvasController): void {
  const rulerEl = document.getElementById('ruler-v') as HTMLCanvasElement;
  if (!rulerEl || rulerEl.classList.contains('hidden')) return;

  const rect = rulerEl.getBoundingClientRect();
  rulerEl.width = rect.width * window.devicePixelRatio;
  rulerEl.height = rect.height * window.devicePixelRatio;

  const ctx = rulerEl.getContext('2d')!;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  const vb = canvas.getViewBox();
  const zoom = canvas.getZoom();

  ctx.fillStyle = '#3c3c3c';
  ctx.fillRect(0, 0, rect.width, rect.height);

  ctx.fillStyle = '#999';
  ctx.strokeStyle = '#666';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';

  const step = getStep(zoom);
  const startY = Math.floor(vb.y / step) * step;

  for (let y = startY; y < vb.y + vb.h; y += step) {
    const screenY = (y - vb.y) * zoom;
    ctx.beginPath();
    ctx.moveTo(rect.width, screenY);
    const isMajor = Math.abs(y % (step * 5)) < 0.5;
    const tickW = isMajor ? 10 : 5;
    ctx.lineTo(rect.width - tickW, screenY);
    ctx.stroke();

    if (isMajor) {
      ctx.save();
      ctx.translate(8, screenY);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(String(Math.round(y)), 0, 0);
      ctx.restore();
    }
  }
}

function getStep(zoom: number): number {
  if (zoom >= 4) return 5;
  if (zoom >= 2) return 10;
  if (zoom >= 1) return 20;
  if (zoom >= 0.5) return 50;
  if (zoom >= 0.25) return 100;
  return 200;
}
