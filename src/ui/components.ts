// ---------------------------------------------------------------------------
// Reusable UI component factories.
//
// The codebase had no component layer: every dialog hand-built buttons, inputs
// and rows with inline `style.cssText` strings that hardcoded colors and sizes
// (duplicating the CSS tokens). These factories produce the same controls from
// token-based `.btn` / `.ui-select` / `.field` / `.check-row` classes in
// style.css, so a control looks and behaves the same wherever it's built and a
// theme change flows through all of them at once.
// ---------------------------------------------------------------------------

export type ButtonVariant = 'default' | 'primary';

export interface ButtonOptions {
  variant?: ButtonVariant;
  /** Compact size (smaller padding/font) for inline/secondary actions. */
  small?: boolean;
  title?: string;
  onClick?: (e: MouseEvent) => void;
}

export function createButton(label: string, opts: ButtonOptions = {}): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn'
    + (opts.variant === 'primary' ? ' btn--primary' : '')
    + (opts.small ? ' btn--sm' : '');
  btn.textContent = label;
  if (opts.title) btn.title = opts.title;
  if (opts.onClick) btn.addEventListener('click', opts.onClick);
  return btn;
}

export interface SelectOption { value: string; label: string; selected?: boolean; }

export function createSelect(options: SelectOption[]): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'ui-select';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.selected) opt.selected = true;
    sel.appendChild(opt);
  }
  return sel;
}

/** A labelled form row: a `.field` wrapping a `.field-label` and the control. */
export function createField(labelText: string, control: HTMLElement): HTMLDivElement {
  const field = document.createElement('div');
  field.className = 'field';
  const label = document.createElement('label');
  label.className = 'field-label';
  label.textContent = labelText;
  field.appendChild(label);
  field.appendChild(control);
  return field;
}

/** A checkbox + text on one clickable `.check-row`. */
export function createCheckRow(
  labelText: string,
  checked: boolean,
  opts: { title?: string; value?: string } = {},
): { row: HTMLLabelElement; input: HTMLInputElement } {
  const row = document.createElement('label');
  row.className = 'check-row';
  if (opts.title) row.title = opts.title;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  if (opts.value !== undefined) input.value = opts.value;
  const text = document.createElement('span');
  text.textContent = labelText;
  row.appendChild(input);
  row.appendChild(text);
  return { row, input };
}

// ---- Dialog section chrome (pairs with the Modal primitive) ----------------

export function createModalHeader(title: string): HTMLDivElement {
  const header = document.createElement('div');
  header.className = 'modal-header';
  const h = document.createElement('span');
  h.className = 'modal-title';
  h.textContent = title;
  header.appendChild(h);
  return header;
}

export function createModalBody(): HTMLDivElement {
  const body = document.createElement('div');
  body.className = 'modal-body';
  return body;
}

export function createModalFooter(): HTMLDivElement {
  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  return footer;
}
