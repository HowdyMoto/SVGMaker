import type { AppState } from '../core/state';

export function setupProperties(state: AppState): void {
  const fillNoneBtn = document.getElementById('prop-fill-none') as HTMLButtonElement;
  const strokeNoneBtn = document.getElementById('prop-stroke-none') as HTMLButtonElement;
  const strokeWidthInput = document.getElementById('prop-stroke-width') as HTMLInputElement;
  const opacityInput = document.getElementById('prop-opacity') as HTMLInputElement;
  const opacityVal = document.getElementById('prop-opacity-val')!;
  const fontSizeInput = document.getElementById('prop-font-size') as HTMLInputElement;
  const fontFamilyInput = document.getElementById('prop-font-family') as HTMLSelectElement;
  const fontWeightInput = document.getElementById('prop-font-weight') as HTMLSelectElement;
  const italicBtn = document.getElementById('prop-italic') as HTMLButtonElement;
  const propRx = document.getElementById('prop-rx') as HTMLInputElement;
  const propX = document.getElementById('prop-x') as HTMLInputElement;
  const propY = document.getElementById('prop-y') as HTMLInputElement;
  const propW = document.getElementById('prop-w') as HTMLInputElement;
  const propH = document.getElementById('prop-h') as HTMLInputElement;

  // Control bar
  const ctrlFill = document.getElementById('ctrl-fill') as HTMLInputElement;
  const ctrlFillNone = document.getElementById('ctrl-fill-none') as HTMLButtonElement;
  const ctrlStroke = document.getElementById('ctrl-stroke') as HTMLInputElement;
  const ctrlStrokeNone = document.getElementById('ctrl-stroke-none') as HTMLButtonElement;
  const ctrlStrokeWeight = document.getElementById('ctrl-stroke-weight') as HTMLInputElement;
  const ctrlOpacity = document.getElementById('ctrl-opacity') as HTMLInputElement;
  const ctrlX = document.getElementById('ctrl-x') as HTMLInputElement;
  const ctrlY = document.getElementById('ctrl-y') as HTMLInputElement;
  const ctrlW = document.getElementById('ctrl-w') as HTMLInputElement;
  const ctrlH = document.getElementById('ctrl-h') as HTMLInputElement;

  // Stroke panel
  const strokeWeight = document.getElementById('stroke-weight') as HTMLInputElement;
  const strokeDash = document.getElementById('stroke-dash') as HTMLInputElement;

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

    el.setAttribute('stroke-width', strokeWidthInput.value);
    shape.style.strokeWidth = parseFloat(strokeWidthInput.value);

    const opacity = parseFloat(opacityInput.value);
    el.setAttribute('opacity', String(opacity));
    shape.style.opacity = opacity;

    if (shape.type === 'text') {
      el.setAttribute('font-size', fontSizeInput.value);
      el.setAttribute('font-family', fontFamilyInput.value);
      el.setAttribute('font-weight', fontWeightInput.value);
      const isItalic = italicBtn.classList.contains('active');
      el.setAttribute('font-style', isItalic ? 'italic' : 'normal');
      shape.style.fontSize = parseFloat(fontSizeInput.value);
      shape.style.fontFamily = fontFamilyInput.value;
      shape.style.fontWeight = fontWeightInput.value;
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

    if (tag === 'rect') {
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

    state.saveHistory();
    state.onChange_public();
  };

  const updateDefaults = () => {
    state.defaultStyle.strokeWidth = parseFloat(strokeWidthInput.value);
    state.defaultStyle.opacity = parseFloat(opacityInput.value);
    state.defaultStyle.fontSize = parseFloat(fontSizeInput.value);
    state.defaultStyle.fontFamily = fontFamilyInput.value;
    state.defaultStyle.fontWeight = fontWeightInput.value;
    state.defaultStyle.fontStyle = italicBtn.classList.contains('active') ? 'italic' : 'normal';
    state.defaultStyle.rx = parseFloat(propRx.value);
    state.fillNone = fillNoneBtn.classList.contains('active');
    state.strokeNone = strokeNoneBtn.classList.contains('active');
  };

  const handleChange = () => {
    opacityVal.textContent = `${Math.round(parseFloat(opacityInput.value) * 100)}%`;
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
  italicBtn.addEventListener('click', () => {
    italicBtn.classList.toggle('active');
    handleChange();
  });

  // Control bar mirrors
  ctrlFillNone.addEventListener('click', () => {
    ctrlFillNone.classList.toggle('active');
    fillNoneBtn.classList.toggle('active', ctrlFillNone.classList.contains('active'));
    handleChange();
  });
  ctrlStrokeNone.addEventListener('click', () => {
    ctrlStrokeNone.classList.toggle('active');
    strokeNoneBtn.classList.toggle('active', ctrlStrokeNone.classList.contains('active'));
    handleChange();
  });

  const syncFromCtrl = () => {
    // Control bar color inputs still apply colors directly
    const shape = state.getSelectedShape();
    if (shape) {
      shape.element.setAttribute('fill', ctrlFill.value);
      shape.style.fill = ctrlFill.value;
      shape.element.setAttribute('stroke', ctrlStroke.value);
      shape.style.stroke = ctrlStroke.value;
    } else {
      state.defaultStyle.fill = ctrlFill.value;
      state.defaultStyle.stroke = ctrlStroke.value;
    }
    strokeWidthInput.value = ctrlStrokeWeight.value;
    strokeWeight.value = ctrlStrokeWeight.value;
    opacityInput.value = String(parseFloat(ctrlOpacity.value) / 100);
    handleChange();
  };

  const syncPosFromCtrl = () => {
    propX.value = ctrlX.value;
    propY.value = ctrlY.value;
    propW.value = ctrlW.value;
    propH.value = ctrlH.value;
    applyPosition();
  };

  ctrlFill.addEventListener('input', syncFromCtrl);
  ctrlStroke.addEventListener('input', syncFromCtrl);
  ctrlStrokeWeight.addEventListener('change', syncFromCtrl);
  ctrlOpacity.addEventListener('change', syncFromCtrl);
  ctrlX.addEventListener('change', syncPosFromCtrl);
  ctrlY.addEventListener('change', syncPosFromCtrl);
  ctrlW.addEventListener('change', syncPosFromCtrl);
  ctrlH.addEventListener('change', syncPosFromCtrl);

  // Stroke weight sync
  strokeWeight.addEventListener('change', () => {
    strokeWidthInput.value = strokeWeight.value;
    ctrlStrokeWeight.value = strokeWeight.value;
    handleChange();
  });

  strokeWidthInput.addEventListener('change', handleChange);
  opacityInput.addEventListener('input', handleChange);
  fontSizeInput.addEventListener('change', handleChange);
  fontFamilyInput.addEventListener('change', handleChange);
  fontWeightInput.addEventListener('change', handleChange);
  propRx.addEventListener('change', handleChange);
  strokeDash.addEventListener('change', handleChange);
  propX.addEventListener('change', applyPosition);
  propY.addEventListener('change', applyPosition);
  propW.addEventListener('change', applyPosition);
  propH.addEventListener('change', applyPosition);

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
  const opacityInput = document.getElementById('prop-opacity') as HTMLInputElement;
  const opacityVal = document.getElementById('prop-opacity-val')!;
  const fontSizeInput = document.getElementById('prop-font-size') as HTMLInputElement;
  const fontFamilyInput = document.getElementById('prop-font-family') as HTMLSelectElement;
  const fontWeightInput = document.getElementById('prop-font-weight') as HTMLSelectElement;
  const italicBtn = document.getElementById('prop-italic') as HTMLButtonElement;
  const typePanel = document.getElementById('panel-type')!;
  const propRx = document.getElementById('prop-rx') as HTMLInputElement;
  const rxRow = document.getElementById('prop-corners-row') as HTMLElement;
  const propX = document.getElementById('prop-x') as HTMLInputElement;
  const propY = document.getElementById('prop-y') as HTMLInputElement;
  const propW = document.getElementById('prop-w') as HTMLInputElement;
  const propH = document.getElementById('prop-h') as HTMLInputElement;
  const strokeWeight = document.getElementById('stroke-weight') as HTMLInputElement;
  const strokeDash = document.getElementById('stroke-dash') as HTMLInputElement;

  // Control bar
  const ctrlFill = document.getElementById('ctrl-fill') as HTMLInputElement;
  const ctrlFillNone = document.getElementById('ctrl-fill-none') as HTMLButtonElement;
  const ctrlStroke = document.getElementById('ctrl-stroke') as HTMLInputElement;
  const ctrlStrokeNone = document.getElementById('ctrl-stroke-none') as HTMLButtonElement;
  const ctrlStrokeWeight = document.getElementById('ctrl-stroke-weight') as HTMLInputElement;
  const ctrlOpacity = document.getElementById('ctrl-opacity') as HTMLInputElement;
  const ctrlX = document.getElementById('ctrl-x') as HTMLInputElement;
  const ctrlY = document.getElementById('ctrl-y') as HTMLInputElement;
  const ctrlW = document.getElementById('ctrl-w') as HTMLInputElement;
  const ctrlH = document.getElementById('ctrl-h') as HTMLInputElement;

  // Toolbar swatches
  const fillSwatch = document.querySelector('#tb-fill-swatch .swatch-inner') as HTMLElement;
  const strokeSwatch = document.querySelector('#tb-stroke-swatch .swatch-inner') as HTMLElement;

  const shape = state.getSelectedShape();

  if (!shape) {
    const ds = state.defaultStyle;
    fillNoneBtn.classList.toggle('active', state.fillNone);
    strokeNoneBtn.classList.toggle('active', state.strokeNone);
    fillPreview.style.background = state.fillNone ? 'transparent' : ds.fill;
    strokePreview.style.background = state.strokeNone ? 'transparent' : ds.stroke;
    strokeWidthInput.value = String(ds.strokeWidth);
    opacityInput.value = String(ds.opacity);
    opacityVal.textContent = `${Math.round(ds.opacity * 100)}%`;
    propRx.value = String(ds.rx ?? 0);
    rxRow.style.display = 'none';
    typePanel.style.display = 'none';
    propX.value = '0'; propY.value = '0'; propW.value = '0'; propH.value = '0';

    ctrlFill.value = ds.fill === 'none' ? '#000000' : ds.fill;
    ctrlFillNone.classList.toggle('active', state.fillNone);
    ctrlStroke.value = ds.stroke === 'none' ? '#000000' : ds.stroke;
    ctrlStrokeNone.classList.toggle('active', state.strokeNone);
    ctrlStrokeWeight.value = String(ds.strokeWidth);
    ctrlOpacity.value = String(Math.round(ds.opacity * 100));
    ctrlX.value = '0'; ctrlY.value = '0'; ctrlW.value = '0'; ctrlH.value = '0';
    strokeWeight.value = String(ds.strokeWidth);
    strokeDash.value = ds.strokeDasharray ?? '';

    fillSwatch.style.background = state.fillNone ? 'transparent' : ds.fill;
    strokeSwatch.style.borderColor = state.strokeNone ? 'transparent' : ds.stroke;

    return;
  }

  const s = shape.style;
  const isFillNone = s.fill === 'none';
  const isStrokeNone = s.stroke === 'none';

  fillNoneBtn.classList.toggle('active', isFillNone);
  strokeNoneBtn.classList.toggle('active', isStrokeNone);
  fillPreview.style.background = isFillNone ? 'transparent' : s.fill;
  strokePreview.style.background = isStrokeNone ? 'transparent' : s.stroke;
  strokeWidthInput.value = String(s.strokeWidth);
  opacityInput.value = String(s.opacity);
  opacityVal.textContent = `${Math.round(s.opacity * 100)}%`;
  propRx.value = String(s.rx ?? 0);
  rxRow.style.display = shape.type === 'rect' ? '' : 'none';
  strokeWeight.value = String(s.strokeWidth);
  strokeDash.value = s.strokeDasharray ?? '';

  ctrlFill.value = isFillNone ? '#000000' : s.fill;
  ctrlFillNone.classList.toggle('active', isFillNone);
  ctrlStroke.value = isStrokeNone ? '#000000' : s.stroke;
  ctrlStrokeNone.classList.toggle('active', isStrokeNone);
  ctrlStrokeWeight.value = String(s.strokeWidth);
  ctrlOpacity.value = String(Math.round(s.opacity * 100));

  fillSwatch.style.background = isFillNone ? 'transparent' : s.fill;
  strokeSwatch.style.borderColor = isStrokeNone ? 'transparent' : s.stroke;

  typePanel.style.display = shape.type === 'text' ? '' : 'none';
  if (shape.type === 'text') {
    fontSizeInput.value = String(s.fontSize ?? 24);
    fontFamilyInput.value = s.fontFamily ?? 'Arial';
    fontWeightInput.value = s.fontWeight ?? 'normal';
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
    ctrlX.value = vals.x; ctrlY.value = vals.y;
    ctrlW.value = vals.w; ctrlH.value = vals.h;
  } catch { /* ignore */ }

  const capBtns = document.querySelectorAll('#stroke-caps button');
  capBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-cap') === (s.strokeLinecap ?? 'butt')));
  const joinBtns = document.querySelectorAll('#stroke-joins button');
  joinBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-join') === (s.strokeLinejoin ?? 'miter')));
}
