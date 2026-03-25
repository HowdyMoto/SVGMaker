import type { AppState } from '../core/state';
import type { GradientDef, GradientStop, PatternDef } from '../core/types';

const SWATCHES = [
  'none',
  '#FFFFFF', '#000000', '#333333', '#666666', '#999999', '#CCCCCC',
  '#FF0000', '#FF6600', '#FFCC00', '#FFFF00', '#99FF00', '#00FF00',
  '#00FF99', '#00FFFF', '#0099FF', '#0000FF', '#6600FF', '#FF00FF',
  '#CC0000', '#CC6600', '#CC9900', '#999900', '#669900', '#009900',
  '#009966', '#009999', '#006699', '#000099', '#660099', '#990066',
  '#990000', '#993300', '#996600', '#666600', '#336600', '#006600',
  '#006633', '#006666', '#003366', '#000066', '#330066', '#660033',
  '#FFB3B3', '#FFD9B3', '#FFF0B3', '#FFFFB3', '#D9FFB3', '#B3FFB3',
  '#B3FFD9', '#B3FFFF', '#B3D9FF', '#B3B3FF', '#D9B3FF', '#FFB3FF',
];

type PaintMode = 'solid' | 'linear' | 'radial' | 'pattern';

let currentOverlay: HTMLElement | null = null;
let currentTarget: 'fill' | 'stroke' = 'fill';

export function setupColorPicker(state: AppState): void {
  document.getElementById('prop-fill-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openPicker(state, 'fill', document.getElementById('prop-fill-btn')!);
  });
  document.getElementById('prop-stroke-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openPicker(state, 'stroke', document.getElementById('prop-stroke-btn')!);
  });
}

function openPicker(state: AppState, target: 'fill' | 'stroke', anchor: HTMLElement): void {
  closePicker();
  currentTarget = target;

  const currentValue = getCurrentColor(state, target);
  const initialMode = detectMode(currentValue);

  const overlay = document.createElement('div');
  overlay.className = 'cpicker-overlay';
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closePicker(); });

  const panel = document.createElement('div');
  panel.className = 'cpicker-panel';
  const rect = anchor.getBoundingClientRect();
  panel.style.top = `${rect.bottom + 4}px`;
  panel.style.left = `${Math.max(8, rect.left - 100)}px`;

  // Header
  const header = document.createElement('div');
  header.className = 'cpicker-header';
  header.textContent = target === 'fill' ? 'Fill' : 'Stroke';
  panel.appendChild(header);

  // Mode tabs
  const tabs = document.createElement('div');
  tabs.className = 'cpicker-tabs';
  const modes: { id: PaintMode; label: string }[] = [
    { id: 'solid', label: 'Solid' },
    { id: 'linear', label: 'Linear' },
    { id: 'radial', label: 'Radial' },
    { id: 'pattern', label: 'Pattern' },
  ];
  const tabBtns: Map<PaintMode, HTMLButtonElement> = new Map();
  for (const m of modes) {
    const btn = document.createElement('button');
    btn.className = 'cpicker-tab';
    btn.textContent = m.label;
    btn.setAttribute('data-mode', m.id);
    if (m.id === initialMode) btn.classList.add('active');
    tabBtns.set(m.id, btn);
    tabs.appendChild(btn);
  }
  panel.appendChild(tabs);

  // Content area — swapped based on active tab
  const content = document.createElement('div');
  content.className = 'cpicker-content';
  panel.appendChild(content);

  const renderMode = (mode: PaintMode) => {
    tabBtns.forEach((btn, id) => btn.classList.toggle('active', id === mode));
    content.innerHTML = '';
    switch (mode) {
      case 'solid': renderSolid(state, content, currentValue); break;
      case 'linear': renderGradient(state, content, 'linear', currentValue); break;
      case 'radial': renderGradient(state, content, 'radial', currentValue); break;
      case 'pattern': renderPattern(state, content, currentValue); break;
    }
  };

  for (const m of modes) {
    tabBtns.get(m.id)!.addEventListener('click', () => renderMode(m.id));
  }

  renderMode(initialMode);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  currentOverlay = overlay;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { closePicker(); window.removeEventListener('keydown', onKey); }
  };
  window.addEventListener('keydown', onKey);
}

function closePicker(): void {
  if (currentOverlay) { currentOverlay.remove(); currentOverlay = null; }
}

// ---- Detect current paint mode ----

function detectMode(value: string): PaintMode {
  if (value.startsWith('url(#grad-')) {
    // Check if gradient id contains 'linear' or 'radial' — we don't know from the url alone
    // Default to linear; the gradient editor will detect the real type
    return 'linear';
  }
  if (value.startsWith('url(#pat-')) return 'pattern';
  return 'solid';
}

// ===================== SOLID MODE =====================

function renderSolid(state: AppState, container: HTMLElement, currentValue: string): void {
  const color = currentValue.startsWith('url(') ? '#FFFFFF' : currentValue;

  // Preview + hex
  const previewRow = document.createElement('div');
  previewRow.className = 'cpicker-preview-row';
  const preview = document.createElement('div');
  preview.className = 'cpicker-preview';
  preview.style.background = color === 'none' ? 'transparent' : color;
  if (color === 'none') preview.classList.add('cpicker-none');

  const hexWrap = document.createElement('div');
  hexWrap.className = 'cpicker-hex-wrap';
  const hashLabel = document.createElement('span');
  hashLabel.textContent = '#';
  hashLabel.className = 'cpicker-hash';
  const hexInput = document.createElement('input');
  hexInput.type = 'text'; hexInput.maxLength = 6;
  hexInput.className = 'cpicker-hex';
  hexInput.value = colorToHex(color);
  hexWrap.appendChild(hashLabel);
  hexWrap.appendChild(hexInput);
  previewRow.appendChild(preview);
  previewRow.appendChild(hexWrap);
  container.appendChild(previewRow);

  // RGB sliders
  const rgb = hexToRgb(colorToHex(color));
  const sliders: { slider: HTMLInputElement; val: HTMLInputElement }[] = [];
  for (const ch of ['R', 'G', 'B']) {
    const row = document.createElement('div');
    row.className = 'cpicker-slider-row';
    const label = document.createElement('label');
    label.textContent = ch; label.className = 'cpicker-slider-label';
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '255';
    slider.value = String(ch === 'R' ? rgb.r : ch === 'G' ? rgb.g : rgb.b);
    slider.className = 'cpicker-slider';
    const val = document.createElement('input');
    val.type = 'number'; val.min = '0'; val.max = '255'; val.value = slider.value;
    val.className = 'cpicker-slider-val';
    row.appendChild(label); row.appendChild(slider); row.appendChild(val);
    container.appendChild(row);
    sliders.push({ slider, val });
  }

  const sync = () => {
    const r = clamp(parseInt(sliders[0].slider.value) || 0);
    const g = clamp(parseInt(sliders[1].slider.value) || 0);
    const b = clamp(parseInt(sliders[2].slider.value) || 0);
    sliders[0].val.value = String(r); sliders[1].val.value = String(g); sliders[2].val.value = String(b);
    const hex = rgbToHex(r, g, b);
    hexInput.value = hex.toUpperCase();
    preview.style.background = '#' + hex; preview.classList.remove('cpicker-none');
    applyPaint(state, '#' + hex);
  };
  const syncFromVals = () => {
    for (const s of sliders) s.slider.value = s.val.value;
    sync();
  };
  const syncFromHex = () => {
    const hex = hexInput.value.replace('#', '');
    if (hex.length !== 6) return;
    const { r, g, b } = hexToRgb(hex);
    sliders[0].slider.value = String(r); sliders[0].val.value = String(r);
    sliders[1].slider.value = String(g); sliders[1].val.value = String(g);
    sliders[2].slider.value = String(b); sliders[2].val.value = String(b);
    preview.style.background = '#' + hex; preview.classList.remove('cpicker-none');
    applyPaint(state, '#' + hex);
  };
  for (const s of sliders) {
    s.slider.addEventListener('input', sync);
    s.val.addEventListener('change', syncFromVals);
  }
  hexInput.addEventListener('change', syncFromHex);

  // Divider + swatches
  const divider = document.createElement('div');
  divider.className = 'cpicker-divider';
  container.appendChild(divider);

  const grid = document.createElement('div');
  grid.className = 'cpicker-swatches';
  for (const c of SWATCHES) {
    const cell = document.createElement('div');
    cell.className = 'swatch-cell';
    if (c === 'none') cell.classList.add('none-swatch');
    else cell.style.background = c;
    cell.addEventListener('click', () => {
      if (c === 'none') {
        applyNone(state);
        preview.style.background = 'transparent'; preview.classList.add('cpicker-none');
      } else {
        const hex = c.replace('#', '');
        hexInput.value = hex.toUpperCase();
        const { r, g, b } = hexToRgb(hex);
        sliders[0].slider.value = String(r); sliders[0].val.value = String(r);
        sliders[1].slider.value = String(g); sliders[1].val.value = String(g);
        sliders[2].slider.value = String(b); sliders[2].val.value = String(b);
        preview.style.background = c; preview.classList.remove('cpicker-none');
        applyPaint(state, c);
      }
    });
    grid.appendChild(cell);
  }
  container.appendChild(grid);
}

// ===================== GRADIENT MODE =====================

function renderGradient(state: AppState, container: HTMLElement, type: 'linear' | 'radial', currentValue: string): void {
  // Find existing gradient or create new
  let grad: GradientDef | undefined;
  const urlMatch = currentValue.match(/url\(#(grad-\d+)\)/);
  if (urlMatch) {
    grad = state.getGradientById(urlMatch[1]);
    // If found but wrong type, we'll create a new one
    if (grad && grad.type !== type) grad = undefined;
  }
  if (!grad) {
    // Default: use shape's current color as start
    const fallbackColor = currentValue.startsWith('url(') ? '#000000' : (currentValue === 'none' ? '#000000' : currentValue);
    grad = state.createGradient(type, [
      { offset: 0, color: fallbackColor, opacity: 1 },
      { offset: 1, color: '#FFFFFF', opacity: 1 },
    ]);
    applyPaint(state, `url(#${grad.id})`);
  }

  // Gradient preview bar
  const previewBar = document.createElement('div');
  previewBar.className = 'cpicker-grad-preview';
  updateGradientPreview(previewBar, grad);
  container.appendChild(previewBar);

  // Stop bar with draggable stops
  const stopBar = document.createElement('div');
  stopBar.className = 'cpicker-stop-bar';
  container.appendChild(stopBar);

  let selectedStopIdx = 0;

  // Stop color editor (for selected stop)
  const stopEditor = document.createElement('div');
  stopEditor.className = 'cpicker-stop-editor';
  container.appendChild(stopEditor);

  // Direction controls
  const dirRow = document.createElement('div');
  dirRow.className = 'cpicker-dir-row';

  if (type === 'linear') {
    dirRow.innerHTML = `
      <label>Angle</label>
      <input type="range" class="cpicker-slider" min="0" max="360" value="${Math.round(gradientAngle(grad))}" id="_grad-angle">
      <input type="number" class="cpicker-slider-val" min="0" max="360" value="${Math.round(gradientAngle(grad))}" id="_grad-angle-val" style="width:42px">&deg;
    `;
  } else {
    dirRow.innerHTML = `
      <label>Focal X</label><input type="range" class="cpicker-slider" min="0" max="100" value="${Math.round((grad.fx ?? 0.5) * 100)}" id="_grad-fx">
      <label>Focal Y</label><input type="range" class="cpicker-slider" min="0" max="100" value="${Math.round((grad.fy ?? 0.5) * 100)}" id="_grad-fy">
    `;
  }
  container.appendChild(dirRow);

  const spreadRow = document.createElement('div');
  spreadRow.className = 'cpicker-dir-row';
  spreadRow.innerHTML = `<label>Spread</label>
    <select id="_grad-spread" class="cpicker-select">
      <option value="pad" ${grad.spreadMethod === 'pad' ? 'selected' : ''}>Pad</option>
      <option value="reflect" ${grad.spreadMethod === 'reflect' ? 'selected' : ''}>Reflect</option>
      <option value="repeat" ${grad.spreadMethod === 'repeat' ? 'selected' : ''}>Repeat</option>
    </select>`;
  container.appendChild(spreadRow);

  // Rebuild stop bar
  const rebuildStops = () => {
    stopBar.innerHTML = '';
    for (let i = 0; i < grad!.stops.length; i++) {
      const stop = grad!.stops[i];
      const handle = document.createElement('div');
      handle.className = 'cpicker-stop-handle';
      if (i === selectedStopIdx) handle.classList.add('active');
      handle.style.left = `${stop.offset * 100}%`;
      handle.style.background = stop.color;
      handle.title = `${Math.round(stop.offset * 100)}%`;
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectedStopIdx = i;
        rebuildStops();
        renderStopEditor();
        // Drag to reposition
        const barRect = stopBar.getBoundingClientRect();
        const onMove = (me: MouseEvent) => {
          let pct = (me.clientX - barRect.left) / barRect.width;
          pct = Math.max(0, Math.min(1, pct));
          grad!.stops[i].offset = Math.round(pct * 100) / 100;
          state.updateGradient(grad!);
          updateGradientPreview(previewBar, grad!);
          rebuildStops();
        };
        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
      stopBar.appendChild(handle);
    }

    // Add stop on double-click
    stopBar.ondblclick = (e) => {
      const barRect = stopBar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - barRect.left) / barRect.width));
      const newStop: GradientStop = { offset: Math.round(pct * 100) / 100, color: '#888888', opacity: 1 };
      grad!.stops.push(newStop);
      grad!.stops.sort((a, b) => a.offset - b.offset);
      selectedStopIdx = grad!.stops.indexOf(newStop);
      state.updateGradient(grad!);
      updateGradientPreview(previewBar, grad!);
      rebuildStops();
      renderStopEditor();
    };
  };

  const renderStopEditor = () => {
    stopEditor.innerHTML = '';
    const stop = grad!.stops[selectedStopIdx];
    if (!stop) return;

    const row = document.createElement('div');
    row.className = 'cpicker-stop-edit-row';
    row.innerHTML = `
      <label>Color</label>
      <input type="color" value="${stop.color}" class="cpicker-stop-color">
      <label>Pos</label>
      <input type="number" min="0" max="100" value="${Math.round(stop.offset * 100)}" class="cpicker-slider-val" style="width:40px">%
    `;
    stopEditor.appendChild(row);

    const colorInput = row.querySelector('.cpicker-stop-color') as HTMLInputElement;
    const posInput = row.querySelector('.cpicker-slider-val') as HTMLInputElement;

    colorInput.addEventListener('input', () => {
      stop.color = colorInput.value;
      state.updateGradient(grad!);
      updateGradientPreview(previewBar, grad!);
      rebuildStops();
    });
    posInput.addEventListener('change', () => {
      stop.offset = clamp100(parseInt(posInput.value) || 0) / 100;
      grad!.stops.sort((a, b) => a.offset - b.offset);
      selectedStopIdx = grad!.stops.indexOf(stop);
      state.updateGradient(grad!);
      updateGradientPreview(previewBar, grad!);
      rebuildStops();
    });

    // Remove stop button (only if > 2 stops)
    if (grad!.stops.length > 2) {
      const rmBtn = document.createElement('button');
      rmBtn.className = 'cpicker-stop-rm';
      rmBtn.textContent = '\u2715';
      rmBtn.title = 'Remove stop';
      rmBtn.addEventListener('click', () => {
        grad!.stops.splice(selectedStopIdx, 1);
        selectedStopIdx = Math.min(selectedStopIdx, grad!.stops.length - 1);
        state.updateGradient(grad!);
        updateGradientPreview(previewBar, grad!);
        rebuildStops();
        renderStopEditor();
      });
      row.appendChild(rmBtn);
    }
  };

  rebuildStops();
  renderStopEditor();

  // Direction change handlers
  if (type === 'linear') {
    const angleSlider = container.querySelector('#_grad-angle') as HTMLInputElement;
    const angleVal = container.querySelector('#_grad-angle-val') as HTMLInputElement;
    const syncAngle = () => {
      const deg = parseFloat(angleSlider.value);
      angleVal.value = String(Math.round(deg));
      const rad = deg * Math.PI / 180;
      grad!.x1 = 0.5 - 0.5 * Math.cos(rad);
      grad!.y1 = 0.5 - 0.5 * Math.sin(rad);
      grad!.x2 = 0.5 + 0.5 * Math.cos(rad);
      grad!.y2 = 0.5 + 0.5 * Math.sin(rad);
      state.updateGradient(grad!);
      updateGradientPreview(previewBar, grad!);
    };
    angleSlider?.addEventListener('input', syncAngle);
    angleVal?.addEventListener('change', () => { angleSlider.value = angleVal.value; syncAngle(); });
  } else {
    const fxSlider = container.querySelector('#_grad-fx') as HTMLInputElement;
    const fySlider = container.querySelector('#_grad-fy') as HTMLInputElement;
    fxSlider?.addEventListener('input', () => {
      grad!.fx = parseInt(fxSlider.value) / 100;
      state.updateGradient(grad!);
      updateGradientPreview(previewBar, grad!);
    });
    fySlider?.addEventListener('input', () => {
      grad!.fy = parseInt(fySlider.value) / 100;
      state.updateGradient(grad!);
      updateGradientPreview(previewBar, grad!);
    });
  }

  const spreadSel = container.querySelector('#_grad-spread') as HTMLSelectElement;
  spreadSel?.addEventListener('change', () => {
    grad!.spreadMethod = spreadSel.value as GradientDef['spreadMethod'];
    state.updateGradient(grad!);
  });
}

function updateGradientPreview(el: HTMLElement, grad: GradientDef): void {
  const stops = grad.stops.map(s => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ');
  if (grad.type === 'linear') {
    const angle = Math.round(gradientAngle(grad));
    el.style.background = `linear-gradient(${angle}deg, ${stops})`;
  } else {
    el.style.background = `radial-gradient(circle at ${Math.round((grad.fx ?? 0.5) * 100)}% ${Math.round((grad.fy ?? 0.5) * 100)}%, ${stops})`;
  }
}

function gradientAngle(grad: GradientDef): number {
  const dx = (grad.x2 ?? 1) - (grad.x1 ?? 0);
  const dy = (grad.y2 ?? 0) - (grad.y1 ?? 0);
  return (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
}

// ===================== PATTERN MODE =====================

function renderPattern(state: AppState, container: HTMLElement, currentValue: string): void {
  let pat: PatternDef | undefined;
  const urlMatch = currentValue.match(/url\(#(pat-\d+)\)/);
  if (urlMatch) pat = state.getPatternById(urlMatch[1]);

  // Type selector
  const typeRow = document.createElement('div');
  typeRow.className = 'cpicker-dir-row';
  typeRow.innerHTML = `<label>Type</label>
    <select id="_pat-type" class="cpicker-select">
      <option value="dots" ${pat?.preset === 'dots' ? 'selected' : ''}>Dots</option>
      <option value="stripes" ${pat?.preset === 'stripes' ? 'selected' : ''}>Stripes</option>
      <option value="crosshatch" ${pat?.preset === 'crosshatch' ? 'selected' : ''}>Crosshatch</option>
      <option value="grid" ${pat?.preset === 'grid' ? 'selected' : ''}>Grid</option>
      <option value="image" ${pat?.type === 'image' ? 'selected' : ''}>Image Texture</option>
    </select>`;
  container.appendChild(typeRow);

  // Preview
  const previewBox = document.createElement('div');
  previewBox.className = 'cpicker-pat-preview';
  container.appendChild(previewBox);

  // Controls container (rebuilt on type change)
  const controls = document.createElement('div');
  container.appendChild(controls);

  const typeSel = container.querySelector('#_pat-type') as HTMLSelectElement;

  const buildPattern = () => {
    const isImage = typeSel.value === 'image';
    controls.innerHTML = '';

    if (isImage) {
      // Upload button
      const uploadBtn = document.createElement('button');
      uploadBtn.className = 'cpicker-upload-btn';
      uploadBtn.textContent = pat?.imageDataUrl ? 'Change Image...' : 'Upload Image...';
      uploadBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg,image/webp';
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const img = new Image();
            img.onload = () => {
              if (pat) {
                pat.type = 'image';
                pat.imageDataUrl = reader.result as string;
                pat.tileWidth = img.naturalWidth;
                pat.tileHeight = img.naturalHeight;
                state.updatePattern(pat);
              } else {
                pat = state.createPattern({
                  type: 'image',
                  imageDataUrl: reader.result as string,
                  tileWidth: img.naturalWidth,
                  tileHeight: img.naturalHeight,
                  scale: Math.min(1, 100 / Math.max(img.naturalWidth, img.naturalHeight)),
                });
                applyPaint(state, `url(#${pat.id})`);
              }
              updatePatternPreview(previewBox, pat);
              buildPattern(); // rebuild controls to show sliders
            };
            img.src = reader.result as string;
          };
          reader.readAsDataURL(file);
        });
        input.click();
      });
      controls.appendChild(uploadBtn);
    } else {
      // Color picker for preset
      const colorRow = document.createElement('div');
      colorRow.className = 'cpicker-dir-row';
      colorRow.innerHTML = `<label>Color</label><input type="color" value="${pat?.presetColor ?? '#000000'}" id="_pat-color">`;
      controls.appendChild(colorRow);

      const colorInput = controls.querySelector('#_pat-color') as HTMLInputElement;
      colorInput?.addEventListener('input', () => {
        if (pat) {
          pat.presetColor = colorInput.value;
          state.updatePattern(pat);
          updatePatternPreview(previewBox, pat);
        }
      });
    }

    // Scale / Rotation / Spacing sliders
    const slidersHtml = `
      <div class="cpicker-dir-row"><label>Scale</label>
        <input type="range" class="cpicker-slider" min="10" max="300" value="${Math.round((pat?.scale ?? 1) * 100)}" id="_pat-scale">
        <span id="_pat-scale-val">${Math.round((pat?.scale ?? 1) * 100)}%</span>
      </div>
      <div class="cpicker-dir-row"><label>Rotation</label>
        <input type="range" class="cpicker-slider" min="0" max="360" value="${pat?.rotation ?? 0}" id="_pat-rotation">
        <span id="_pat-rot-val">${pat?.rotation ?? 0}&deg;</span>
      </div>
      <div class="cpicker-dir-row"><label>Spacing</label>
        <input type="range" class="cpicker-slider" min="0" max="50" value="${pat?.spacing ?? 0}" id="_pat-spacing">
        <span id="_pat-spc-val">${pat?.spacing ?? 0}px</span>
      </div>
    `;
    const sliderDiv = document.createElement('div');
    sliderDiv.innerHTML = slidersHtml;
    controls.appendChild(sliderDiv);

    const scaleSlider = controls.querySelector('#_pat-scale') as HTMLInputElement;
    const rotSlider = controls.querySelector('#_pat-rotation') as HTMLInputElement;
    const spcSlider = controls.querySelector('#_pat-spacing') as HTMLInputElement;

    const updatePat = () => {
      if (!pat) return;
      pat.scale = parseInt(scaleSlider.value) / 100;
      pat.rotation = parseInt(rotSlider.value);
      pat.spacing = parseInt(spcSlider.value);
      (controls.querySelector('#_pat-scale-val') as HTMLElement).textContent = `${scaleSlider.value}%`;
      (controls.querySelector('#_pat-rot-val') as HTMLElement).textContent = `${rotSlider.value}\u00B0`;
      (controls.querySelector('#_pat-spc-val') as HTMLElement).textContent = `${spcSlider.value}px`;
      state.updatePattern(pat);
      updatePatternPreview(previewBox, pat);
    };
    scaleSlider?.addEventListener('input', updatePat);
    rotSlider?.addEventListener('input', updatePat);
    spcSlider?.addEventListener('input', updatePat);
  };

  typeSel.addEventListener('change', () => {
    const isImage = typeSel.value === 'image';
    if (!isImage) {
      const preset = typeSel.value as PatternDef['preset'];
      if (pat) {
        pat.type = 'preset';
        pat.preset = preset;
        state.updatePattern(pat);
      } else {
        pat = state.createPattern({ type: 'preset', preset, tileWidth: 20, tileHeight: 20 });
        applyPaint(state, `url(#${pat.id})`);
      }
      updatePatternPreview(previewBox, pat);
    }
    buildPattern();
  });

  // Initialize
  if (!pat) {
    pat = state.createPattern({ type: 'preset', preset: 'dots', tileWidth: 20, tileHeight: 20 });
    applyPaint(state, `url(#${pat.id})`);
  }
  updatePatternPreview(previewBox, pat);
  buildPattern();
}

function updatePatternPreview(el: HTMLElement, pat: PatternDef): void {
  if (pat.type === 'image' && pat.imageDataUrl) {
    const size = Math.round(pat.tileWidth * pat.scale + pat.spacing);
    el.style.background = `url(${pat.imageDataUrl})`;
    el.style.backgroundSize = `${size}px`;
    if (pat.rotation) el.style.transform = `rotate(${pat.rotation}deg)`;
    else el.style.transform = '';
  } else {
    // CSS approximation of preset
    const c = pat.presetColor ?? '#000';
    const s = Math.round((pat.tileWidth * pat.scale + pat.spacing));
    switch (pat.preset) {
      case 'dots':
        el.style.background = `radial-gradient(circle, ${c} 1px, transparent 1px)`;
        el.style.backgroundSize = `${s}px ${s}px`;
        break;
      case 'stripes':
        el.style.background = `repeating-linear-gradient(90deg, ${c} 0px, ${c} 2px, transparent 2px, transparent ${s}px)`;
        el.style.backgroundSize = '';
        break;
      case 'crosshatch':
        el.style.background = `repeating-linear-gradient(45deg, ${c} 0px, ${c} 1px, transparent 1px, transparent ${s}px), repeating-linear-gradient(-45deg, ${c} 0px, ${c} 1px, transparent 1px, transparent ${s}px)`;
        el.style.backgroundSize = '';
        break;
      case 'grid':
        el.style.background = `repeating-linear-gradient(0deg, ${c} 0px, ${c} 1px, transparent 1px, transparent ${s}px), repeating-linear-gradient(90deg, ${c} 0px, ${c} 1px, transparent 1px, transparent ${s}px)`;
        el.style.backgroundSize = '';
        break;
      default:
        el.style.background = '#eee';
    }
    if (pat.rotation) el.style.transform = `rotate(${pat.rotation}deg)`;
    else el.style.transform = '';
  }
}

// ===================== APPLY HELPERS =====================

function applyPaint(state: AppState, value: string): void {
  if (currentTarget === 'fill') {
    state.defaultStyle.fill = value;
    state.fillNone = false;
    const shape = state.getSelectedShape();
    if (shape) {
      shape.element.setAttribute('fill', value);
      shape.style.fill = value;
      state.saveHistory();
    }
  } else {
    state.defaultStyle.stroke = value;
    state.strokeNone = false;
    const shape = state.getSelectedShape();
    if (shape) {
      shape.element.setAttribute('stroke', value);
      shape.style.stroke = value;
      state.saveHistory();
    }
  }
  state.onChange_public();
}

function applyNone(state: AppState): void {
  if (currentTarget === 'fill') {
    state.fillNone = true;
    const shape = state.getSelectedShape();
    if (shape) { shape.element.setAttribute('fill', 'none'); shape.style.fill = 'none'; state.saveHistory(); }
  } else {
    state.strokeNone = true;
    const shape = state.getSelectedShape();
    if (shape) { shape.element.setAttribute('stroke', 'none'); shape.style.stroke = 'none'; state.saveHistory(); }
  }
  state.onChange_public();
}

function getCurrentColor(state: AppState, target: 'fill' | 'stroke'): string {
  const shape = state.getSelectedShape();
  if (target === 'fill') return shape ? shape.style.fill : (state.fillNone ? 'none' : state.defaultStyle.fill);
  return shape ? shape.style.stroke : (state.strokeNone ? 'none' : state.defaultStyle.stroke);
}

// ===================== COLOR UTILS =====================

function colorToHex(color: string): string {
  if (!color || color === 'none' || color.startsWith('url(')) return 'FFFFFF';
  return color.replace('#', '').toUpperCase();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  hex = hex.replace('#', '');
  if (hex.length !== 6) return { r: 255, g: 255, b: 255 };
  return {
    r: parseInt(hex.substring(0, 2), 16) || 0,
    g: parseInt(hex.substring(2, 4), 16) || 0,
    b: parseInt(hex.substring(4, 6), 16) || 0,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function clamp(v: number): number { return Math.max(0, Math.min(255, v)); }
function clamp100(v: number): number { return Math.max(0, Math.min(100, v)); }
