import type { AppState } from '../core/state';
import { setRotation } from '../core/transform';
import { applyStrokeAlignment, type StrokeAlign } from '../core/stroke-align';
import { populateFontSelect } from '../fonts';

/** Convert SVG fill/stroke values to CSS-renderable backgrounds for preview swatches */
function paintPreviewBg(value: string, state: AppState): string {
  if (!value || value === 'none') return 'transparent';
  if (value.startsWith('url(#grad-')) {
    const id = value.match(/url\(#(grad-\d+)\)/)?.[1];
    if (id) {
      const grad = state.getGradientById(id);
      if (grad) {
        const stops = grad.stops.map(s => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ');
        if (grad.type === 'linear') {
          const dx = (grad.x2 ?? 1) - (grad.x1 ?? 0);
          const dy = (grad.y2 ?? 0) - (grad.y1 ?? 0);
          const angle = Math.round((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360);
          return `linear-gradient(${angle}deg, ${stops})`;
        }
        return `radial-gradient(circle, ${stops})`;
      }
    }
  }
  if (value.startsWith('url(#pat-')) {
    return 'repeating-conic-gradient(#555 0% 25%, #666 0% 50%) 0 0/8px 8px';
  }
  if (value.startsWith('url(')) return '#888';
  return value;
}

/** Reflect the active stroke-alignment in the segmented button group. */
function setActiveAlign(group: HTMLElement, align: string): void {
  group.querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-align') === align));
}

/** Show the Point-type row while node-editing and reflect the selection's type. */
function updateNodeRow(state: AppState): void {
  const row = document.getElementById('prop-node-row') as HTMLElement | null;
  if (!row) return;
  const session = state.pathEdit;
  const active = !!(state.editingPathId && session && session.selected.size > 0);
  row.style.display = active ? '' : 'none';
  if (!active) return;
  const type = session!.selectionType();
  (document.getElementById('prop-node-corner') as HTMLButtonElement).classList.toggle('active', type === 'corner');
  (document.getElementById('prop-node-smooth') as HTMLButtonElement).classList.toggle('active', type === 'smooth');
  (document.getElementById('prop-node-broken') as HTMLButtonElement).classList.toggle('active', type === 'broken');
}

export function setupProperties(state: AppState): void {
  // Node point-type buttons (visible only while node-editing a path).
  for (const [id, type] of [
    ['prop-node-corner', 'corner'], ['prop-node-smooth', 'smooth'], ['prop-node-broken', 'broken'],
  ] as const) {
    document.getElementById(id)?.addEventListener('click', () => {
      if (!state.pathEdit || state.pathEdit.selected.size === 0) return;
      state.pathEdit.setSelectedType(type);
      state.commitPathEdit();
    });
  }

  const fillNoneBtn = document.getElementById('prop-fill-none') as HTMLButtonElement;
  const strokeNoneBtn = document.getElementById('prop-stroke-none') as HTMLButtonElement;
  const strokeWidthInput = document.getElementById('prop-stroke-width') as HTMLInputElement;
  const fillOpacityInput = document.getElementById('prop-fill-opacity') as HTMLInputElement;
  const fillOpacityVal = document.getElementById('prop-fill-opacity-val')!;
  const strokeOpacityInput = document.getElementById('prop-stroke-opacity') as HTMLInputElement;
  const strokeOpacityVal = document.getElementById('prop-stroke-opacity-val')!;
  const fontSizeInput = document.getElementById('prop-font-size') as HTMLInputElement;
  const fontFamilyInput = document.getElementById('prop-font-family') as HTMLSelectElement;
  populateFontSelect(fontFamilyInput);
  const boldBtn = document.getElementById('prop-bold') as HTMLButtonElement;
  const italicBtn = document.getElementById('prop-italic') as HTMLButtonElement;
  const propRx = document.getElementById('prop-rx') as HTMLInputElement;
  const propX = document.getElementById('prop-x') as HTMLInputElement;
  const propY = document.getElementById('prop-y') as HTMLInputElement;
  const propW = document.getElementById('prop-w') as HTMLInputElement;
  const propH = document.getElementById('prop-h') as HTMLInputElement;
  const propRotation = document.getElementById('prop-rotation') as HTMLInputElement;

  // Stroke panel
  const strokeWeight = document.getElementById('stroke-weight') as HTMLInputElement;
  const strokeDash = document.getElementById('stroke-dash') as HTMLInputElement;
  const strokeDashoffsetInput = document.getElementById('stroke-dashoffset') as HTMLInputElement;
  const strokeMiterInput = document.getElementById('stroke-miterlimit') as HTMLInputElement;
  const strokeNonScalingInput = document.getElementById('stroke-nonscaling') as HTMLInputElement;
  const strokeAlignGroup = document.getElementById('stroke-align') as HTMLElement;
  const currentStrokeAlign = (): StrokeAlign =>
    (strokeAlignGroup.querySelector('button.active')?.getAttribute('data-align') as StrokeAlign) || 'center';

  const applyToShape = () => {
    const shape = state.getSelectedShape();
    if (!shape) return;
    const el = shape.element;

    const fillNone = fillNoneBtn.classList.contains('active');
    const strokeNone = strokeNoneBtn.classList.contains('active');

    if (fillNone) {
      el.setAttribute('fill', 'none');
      shape.style.fill = 'none';
    }

    if (strokeNone) {
      el.setAttribute('stroke', 'none');
      shape.style.stroke = 'none';
    }

    // DOM stroke-width is finalized by applyStrokeAlignment below (doubled when
    // inside/outside-aligned); here we just record the authored width.
    const authoredWidth = parseFloat(strokeWidthInput.value) || 0;
    shape.style.strokeWidth = authoredWidth;

    const fillOpacity = parseFloat(fillOpacityInput.value);
    if (fillOpacity < 1) el.setAttribute('fill-opacity', String(fillOpacity));
    else el.removeAttribute('fill-opacity');
    shape.style.fillOpacity = fillOpacity;

    const strokeOpacity = parseFloat(strokeOpacityInput.value);
    if (strokeOpacity < 1) el.setAttribute('stroke-opacity', String(strokeOpacity));
    else el.removeAttribute('stroke-opacity');
    shape.style.strokeOpacity = strokeOpacity;

    if (shape.type === 'text') {
      const isBold = boldBtn.classList.contains('active');
      const isItalic = italicBtn.classList.contains('active');
      el.setAttribute('font-size', fontSizeInput.value);
      el.setAttribute('font-family', fontFamilyInput.value);
      el.setAttribute('font-weight', isBold ? 'bold' : 'normal');
      el.setAttribute('font-style', isItalic ? 'italic' : 'normal');
      shape.style.fontSize = parseFloat(fontSizeInput.value);
      shape.style.fontFamily = fontFamilyInput.value;
      shape.style.fontWeight = isBold ? 'bold' : 'normal';
      shape.style.fontStyle = isItalic ? 'italic' : 'normal';
    }

    if (shape.type === 'rect' && propRx) {
      el.setAttribute('rx', propRx.value);
      el.setAttribute('ry', propRx.value);
      shape.style.rx = parseFloat(propRx.value);
    }

    const dash = strokeDash.value.trim();
    if (dash) {
      el.setAttribute('stroke-dasharray', dash);
      shape.style.strokeDasharray = dash;
    } else {
      el.removeAttribute('stroke-dasharray');
      shape.style.strokeDasharray = '';
    }

    const dashOffset = parseFloat(strokeDashoffsetInput.value) || 0;
    if (dashOffset) el.setAttribute('stroke-dashoffset', String(dashOffset));
    else el.removeAttribute('stroke-dashoffset');
    shape.style.strokeDashoffset = dashOffset;

    const miter = parseFloat(strokeMiterInput.value) || 4;
    if (miter !== 4) el.setAttribute('stroke-miterlimit', String(miter));
    else el.removeAttribute('stroke-miterlimit');
    shape.style.strokeMiterlimit = miter;

    const nonScaling = strokeNonScalingInput.checked;
    if (nonScaling) el.setAttribute('vector-effect', 'non-scaling-stroke');
    else el.removeAttribute('vector-effect');
    shape.style.strokeNonScaling = nonScaling;

    // Apply alignment last — it owns the final DOM stroke-width + clip-path.
    const align = currentStrokeAlign();
    shape.style.strokeAlign = align;
    applyStrokeAlignment(el, shape.type, align, authoredWidth);

    state.saveHistory();
    state.onChange_public();
  };

  const applyPosition = () => {
    const shape = state.getSelectedShape();
    if (!shape) return;
    const el = shape.element;
    const tag = el.tagName.toLowerCase();
    const x = parseFloat(propX.value);
    const y = parseFloat(propY.value);
    const w = parseFloat(propW.value);
    const h = parseFloat(propH.value);

    if (tag === 'rect' || tag === 'image' || tag === 'use') {
      el.setAttribute('x', String(x));
      el.setAttribute('y', String(y));
      el.setAttribute('width', String(w));
      el.setAttribute('height', String(h));
    } else if (tag === 'ellipse') {
      el.setAttribute('cx', String(x + w / 2));
      el.setAttribute('cy', String(y + h / 2));
      el.setAttribute('rx', String(w / 2));
      el.setAttribute('ry', String(h / 2));
    } else if (tag === 'text') {
      el.setAttribute('x', String(x));
      el.setAttribute('y', String(y + h));
    }

    // Apply rotation about the element's centre, preserving any translate. Frames
    // stay axis-aligned (they double as export units; rotation would break
    // export/rulers/grid) — never rotate one, even via the field.
    if (shape.type !== 'frame') {
      const rotation = parseFloat(propRotation.value) || 0;
      shape.rotation = rotation;
      const bbox = (el as unknown as SVGGraphicsElement).getBBox();
      setRotation(el, rotation, bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
    }

    state.saveHistory();
    state.onChange_public();
  };

  const updateDefaults = () => {
    state.defaultStyle.strokeWidth = parseFloat(strokeWidthInput.value);
    state.defaultStyle.fillOpacity = parseFloat(fillOpacityInput.value);
    state.defaultStyle.strokeOpacity = parseFloat(strokeOpacityInput.value);
    state.defaultStyle.fontSize = parseFloat(fontSizeInput.value);
    state.defaultStyle.fontFamily = fontFamilyInput.value;
    state.defaultStyle.fontWeight = boldBtn.classList.contains('active') ? 'bold' : 'normal';
    state.defaultStyle.fontStyle = italicBtn.classList.contains('active') ? 'italic' : 'normal';
    state.defaultStyle.rx = parseFloat(propRx.value);
    state.defaultStyle.strokeAlign = currentStrokeAlign();
    state.defaultStyle.strokeDashoffset = parseFloat(strokeDashoffsetInput.value) || 0;
    state.defaultStyle.strokeMiterlimit = parseFloat(strokeMiterInput.value) || 4;
    state.defaultStyle.strokeNonScaling = strokeNonScalingInput.checked;
    state.fillNone = fillNoneBtn.classList.contains('active');
    state.strokeNone = strokeNoneBtn.classList.contains('active');
  };

  const handleChange = () => {
    fillOpacityVal.textContent = `${Math.round(parseFloat(fillOpacityInput.value) * 100)}%`;
    strokeOpacityVal.textContent = `${Math.round(parseFloat(strokeOpacityInput.value) * 100)}%`;
    const shape = state.getSelectedShape();
    if (shape) applyToShape();
    else updateDefaults();
  };

  // Fill/Stroke none toggles
  fillNoneBtn.addEventListener('click', () => {
    fillNoneBtn.classList.toggle('active');
    handleChange();
  });
  strokeNoneBtn.addEventListener('click', () => {
    strokeNoneBtn.classList.toggle('active');
    handleChange();
  });
  boldBtn.addEventListener('click', () => {
    boldBtn.classList.toggle('active');
    handleChange();
  });
  italicBtn.addEventListener('click', () => {
    italicBtn.classList.toggle('active');
    handleChange();
  });

  // Stroke weight sync. `input` fires live (so drag-scrub previews); `change`
  // is the final commit. Both run handleChange — matching the opacity sliders.
  const syncStrokeWeight = () => {
    strokeWidthInput.value = strokeWeight.value;
    handleChange();
  };
  strokeWeight.addEventListener('input', syncStrokeWeight);
  strokeWeight.addEventListener('change', syncStrokeWeight);

  strokeWidthInput.addEventListener('input', handleChange);
  strokeWidthInput.addEventListener('change', handleChange);
  fillOpacityInput.addEventListener('input', handleChange);
  strokeOpacityInput.addEventListener('input', handleChange);
  fontSizeInput.addEventListener('change', handleChange);
  fontFamilyInput.addEventListener('change', handleChange);
  propRx.addEventListener('change', handleChange);
  strokeDash.addEventListener('change', handleChange);
  strokeDashoffsetInput.addEventListener('change', handleChange);
  strokeMiterInput.addEventListener('change', handleChange);
  strokeNonScalingInput.addEventListener('change', handleChange);
  propX.addEventListener('change', applyPosition);
  propY.addEventListener('change', applyPosition);
  propW.addEventListener('change', applyPosition);
  propH.addEventListener('change', applyPosition);
  propRotation.addEventListener('change', applyPosition);

  // Stroke cap buttons
  document.querySelectorAll('#stroke-caps button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#stroke-caps button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cap = btn.getAttribute('data-cap')!;
      const shape = state.getSelectedShape();
      if (shape) {
        shape.element.setAttribute('stroke-linecap', cap);
        shape.style.strokeLinecap = cap;
        state.saveHistory();
        state.onChange_public();
      } else {
        state.defaultStyle.strokeLinecap = cap;
      }
    });
  });

  // Stroke join buttons
  document.querySelectorAll('#stroke-joins button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#stroke-joins button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const join = btn.getAttribute('data-join')!;
      const shape = state.getSelectedShape();
      if (shape) {
        shape.element.setAttribute('stroke-linejoin', join);
        shape.style.strokeLinejoin = join;
        state.saveHistory();
        state.onChange_public();
      } else {
        state.defaultStyle.strokeLinejoin = join;
      }
    });
  });

  // Stroke alignment buttons (center / inside / outside). Routes through
  // handleChange so applyToShape re-applies the clip + doubled width.
  strokeAlignGroup.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      strokeAlignGroup.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      handleChange();
    });
  });

  // Stroke details expand/collapse
  const strokeExpandBtn = document.getElementById('stroke-expand') as HTMLButtonElement;
  const strokeDetails = document.getElementById('stroke-details') as HTMLElement;
  // Start collapsed
  strokeDetails.classList.add('collapsed');
  strokeExpandBtn.classList.add('collapsed');
  strokeExpandBtn.addEventListener('click', () => {
    strokeDetails.classList.toggle('collapsed');
    strokeExpandBtn.classList.toggle('collapsed');
  });
}

export function updatePropertiesPanel(state: AppState): void {
  const fillNoneBtn = document.getElementById('prop-fill-none') as HTMLButtonElement;
  const strokeNoneBtn = document.getElementById('prop-stroke-none') as HTMLButtonElement;
  const fillPreview = document.getElementById('prop-fill-preview') as HTMLElement;
  const strokePreview = document.getElementById('prop-stroke-preview') as HTMLElement;
  const strokeWidthInput = document.getElementById('prop-stroke-width') as HTMLInputElement;
  const fillOpacityInput = document.getElementById('prop-fill-opacity') as HTMLInputElement;
  const fillOpacityVal = document.getElementById('prop-fill-opacity-val')!;
  const strokeOpacityInput = document.getElementById('prop-stroke-opacity') as HTMLInputElement;
  const strokeOpacityVal = document.getElementById('prop-stroke-opacity-val')!;
  const fontSizeInput = document.getElementById('prop-font-size') as HTMLInputElement;
  const fontFamilyInput = document.getElementById('prop-font-family') as HTMLSelectElement;
  const boldBtn = document.getElementById('prop-bold') as HTMLButtonElement;
  const italicBtn = document.getElementById('prop-italic') as HTMLButtonElement;
  const typePanel = document.getElementById('panel-type')!;
  const propRx = document.getElementById('prop-rx') as HTMLInputElement;
  const rxRow = document.getElementById('prop-corners-row') as HTMLElement;
  const propX = document.getElementById('prop-x') as HTMLInputElement;
  const propY = document.getElementById('prop-y') as HTMLInputElement;
  const propW = document.getElementById('prop-w') as HTMLInputElement;
  const propH = document.getElementById('prop-h') as HTMLInputElement;
  const propRotation = document.getElementById('prop-rotation') as HTMLInputElement;
  const strokeWeight = document.getElementById('stroke-weight') as HTMLInputElement;
  const strokeDash = document.getElementById('stroke-dash') as HTMLInputElement;
  const strokeDashoffsetInput = document.getElementById('stroke-dashoffset') as HTMLInputElement;
  const strokeMiterInput = document.getElementById('stroke-miterlimit') as HTMLInputElement;
  const strokeNonScalingInput = document.getElementById('stroke-nonscaling') as HTMLInputElement;
  const strokeAlignGroup = document.getElementById('stroke-align') as HTMLElement;

  // Toolbar swatches
  const fillSwatch = document.querySelector('#tb-fill-swatch .swatch-inner') as HTMLElement;
  const strokeSwatch = document.querySelector('#tb-stroke-swatch .swatch-inner') as HTMLElement;

  const shape = state.getSelectedShape();

  if (!shape) {
    const ds = state.defaultStyle;
    fillNoneBtn.classList.toggle('active', state.fillNone);
    strokeNoneBtn.classList.toggle('active', state.strokeNone);
    fillPreview.style.background = state.fillNone ? 'transparent' : paintPreviewBg(ds.fill, state);
    strokePreview.style.background = state.strokeNone ? 'transparent' : paintPreviewBg(ds.stroke, state);
    strokeWidthInput.value = String(ds.strokeWidth);
    const dfo = ds.fillOpacity ?? 1;
    fillOpacityInput.value = String(dfo);
    fillOpacityVal.textContent = `${Math.round(dfo * 100)}%`;
    const dso = ds.strokeOpacity ?? 1;
    strokeOpacityInput.value = String(dso);
    strokeOpacityVal.textContent = `${Math.round(dso * 100)}%`;
    propRx.value = String(ds.rx ?? 0);
    rxRow.style.display = 'none';
    updateNodeRow(state);
    typePanel.style.display = 'none';
    propX.value = '0'; propY.value = '0'; propW.value = '0'; propH.value = '0';
    propRotation.value = '0';
    const rotRow0 = document.getElementById('prop-rotation-row');
    if (rotRow0) rotRow0.style.display = ''; // reset after a frame was selected
    strokeWeight.value = String(ds.strokeWidth);
    strokeDash.value = ds.strokeDasharray ?? '';
    strokeDashoffsetInput.value = String(ds.strokeDashoffset ?? 0);
    strokeMiterInput.value = String(ds.strokeMiterlimit ?? 4);
    strokeNonScalingInput.checked = !!ds.strokeNonScaling;
    setActiveAlign(strokeAlignGroup, ds.strokeAlign ?? 'center');

    fillSwatch.style.background = state.fillNone ? 'transparent' : paintPreviewBg(ds.fill, state);
    strokeSwatch.style.borderColor = state.strokeNone ? 'transparent' : (ds.stroke.startsWith('url(') ? '#888' : ds.stroke);

    return;
  }

  const s = shape.style;
  const isFillNone = s.fill === 'none';
  const isStrokeNone = s.stroke === 'none';

  fillNoneBtn.classList.toggle('active', isFillNone);
  strokeNoneBtn.classList.toggle('active', isStrokeNone);
  fillPreview.style.background = isFillNone ? 'transparent' : paintPreviewBg(s.fill, state);
  strokePreview.style.background = isStrokeNone ? 'transparent' : paintPreviewBg(s.stroke, state);
  strokeWidthInput.value = String(s.strokeWidth);
  const fo = s.fillOpacity ?? 1;
  fillOpacityInput.value = String(fo);
  fillOpacityVal.textContent = `${Math.round(fo * 100)}%`;
  const so = s.strokeOpacity ?? 1;
  strokeOpacityInput.value = String(so);
  strokeOpacityVal.textContent = `${Math.round(so * 100)}%`;
  propRx.value = String(s.rx ?? 0);
  rxRow.style.display = shape.type === 'rect' ? '' : 'none';
  updateNodeRow(state);
  strokeWeight.value = String(s.strokeWidth);
  strokeDash.value = s.strokeDasharray ?? '';
  strokeDashoffsetInput.value = String(s.strokeDashoffset ?? 0);
  strokeMiterInput.value = String(s.strokeMiterlimit ?? 4);
  strokeNonScalingInput.checked = !!s.strokeNonScaling;
  setActiveAlign(strokeAlignGroup, s.strokeAlign ?? 'center');

  fillSwatch.style.background = isFillNone ? 'transparent' : paintPreviewBg(s.fill, state);
  strokeSwatch.style.borderColor = isStrokeNone ? 'transparent' : (s.stroke.startsWith('url(') ? '#888' : s.stroke);

  typePanel.style.display = shape.type === 'text' ? '' : 'none';
  if (shape.type === 'text') {
    fontSizeInput.value = String(s.fontSize ?? 24);
    fontFamilyInput.value = s.fontFamily ?? 'Arial';
    const w = String(s.fontWeight ?? 'normal');
    boldBtn.classList.toggle('active', w === 'bold' || parseInt(w) >= 600);
    italicBtn.classList.toggle('active', s.fontStyle === 'italic');
  }

  try {
    const bbox = (shape.element as unknown as SVGGraphicsElement).getBBox();
    const vals = {
      x: String(Math.round(bbox.x)),
      y: String(Math.round(bbox.y)),
      w: String(Math.round(bbox.width)),
      h: String(Math.round(bbox.height)),
    };
    propX.value = vals.x; propY.value = vals.y;
    propW.value = vals.w; propH.value = vals.h;

    const rotVal = String(Math.round(shape.rotation ?? 0));
    propRotation.value = rotVal;
  } catch { /* ignore */ }

  // Frames can't be rotated (they double as axis-aligned export units) — hide the
  // rotation field so it isn't offered.
  const rotRow = document.getElementById('prop-rotation-row');
  if (rotRow) rotRow.style.display = shape.type === 'frame' ? 'none' : '';

  const capBtns = document.querySelectorAll('#stroke-caps button');
  capBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-cap') === (s.strokeLinecap ?? 'butt')));
  const joinBtns = document.querySelectorAll('#stroke-joins button');
  joinBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-join') === (s.strokeLinejoin ?? 'miter')));
}
