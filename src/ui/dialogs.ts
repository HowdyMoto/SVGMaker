// ---------------------------------------------------------------------------
// Elegant promise-based dialogs — replacements for window.prompt / .confirm.
//
// Built on the shared Modal primitive (ui/modal.ts). Each returns a Promise that
// resolves when the user confirms, cancels, presses Escape, or clicks the
// backdrop. Styling lives in the `.dlg-*` classes in style.css. These stack over
// other modals (e.g. the cloud browser), so each uses a unique overlay id.
// ---------------------------------------------------------------------------

import { openModal, type ModalHandle } from './modal';

let seq = 0;
const uid = (): string => `dlg-${++seq}`;

interface BaseOpts {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

/** Shared surface: title, optional message, a body you fill, and a button row.
 *  Resolves once — via confirm(), cancel, Escape, or backdrop. */
function formModal<T>(
  opts: BaseOpts,
  build: (body: HTMLElement, submit: () => void) => void,
  collect: () => T,
): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    let modal: ModalHandle | null = null;
    const finish = (value: T | null) => {
      if (done) return;
      done = true;
      modal?.close();               // triggers onClose → finish(null), guarded by `done`
      resolve(value);
    };

    modal = openModal({
      id: uid(),
      ariaLabel: opts.title,
      dialogClass: 'dlg',
      closeButton: false,
      onClose: () => finish(null),
    });
    if (!modal) { resolve(null); return; }

    const submit = () => finish(collect());

    const head = document.createElement('div');
    head.className = 'dlg-head';
    const h = document.createElement('h2');
    h.className = 'dlg-title';
    h.textContent = opts.title;
    head.appendChild(h);
    if (opts.message) {
      const m = document.createElement('p');
      m.className = 'dlg-msg';
      m.textContent = opts.message;
      head.appendChild(m);
    }
    modal.dialog.appendChild(head);

    const body = document.createElement('div');
    body.className = 'dlg-body';
    modal.dialog.appendChild(body);
    build(body, submit);

    const foot = document.createElement('div');
    foot.className = 'dlg-foot';
    const cancel = document.createElement('button');
    cancel.className = 'dlg-btn';
    cancel.textContent = opts.cancelText ?? 'Cancel';
    cancel.addEventListener('click', () => finish(null));
    const ok = document.createElement('button');
    ok.className = 'dlg-btn dlg-btn-primary' + (opts.danger ? ' dlg-btn-danger' : '');
    ok.textContent = opts.confirmText ?? 'OK';
    ok.addEventListener('click', submit);
    foot.append(cancel, ok);
    modal.dialog.appendChild(foot);
  });
}

/** A styled confirm(). Resolves true only if the user clicks the confirm button. */
export function confirmDialog(opts: BaseOpts): Promise<boolean> {
  return formModal<boolean>(
    { confirmText: 'Confirm', ...opts },
    () => { /* message-only body */ },
    () => true,
  ).then((v) => v === true);
}

interface PromptOpts extends BaseOpts {
  label?: string;
  value?: string;
  placeholder?: string;
  /** Suggestions offered via a <datalist> (e.g. existing categories). */
  suggestions?: string[];
}

/** A styled prompt(). Resolves the trimmed string, or null if cancelled. */
export function promptDialog(opts: PromptOpts): Promise<string | null> {
  let input: HTMLInputElement;
  return formModal<string>(
    { confirmText: 'Save', ...opts },
    (body, submit) => {
      if (opts.label) {
        const l = document.createElement('label');
        l.className = 'dlg-label';
        l.textContent = opts.label;
        body.appendChild(l);
      }
      input = document.createElement('input');
      input.className = 'dlg-input';
      input.type = 'text';
      input.value = opts.value ?? '';
      if (opts.placeholder) input.placeholder = opts.placeholder;
      input.autocomplete = 'off';
      input.spellcheck = false;
      if (opts.suggestions?.length) {
        const dlId = uid();
        const dl = document.createElement('datalist');
        dl.id = dlId;
        for (const s of opts.suggestions) { const o = document.createElement('option'); o.value = s; dl.appendChild(o); }
        body.appendChild(dl);
        input.setAttribute('list', dlId);
      }
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      body.appendChild(input);
      queueMicrotask(() => { input.focus(); input.select(); });
    },
    () => input.value.trim(),
  );
}

export interface SaveDialogResult {
  name: string;
  category: string | null;
  visibility: 'private' | 'public';
}

/** The Save-to-Cloud dialog: name, optional category, and a Private/Public toggle. */
export function saveToCloudDialog(opts: { name: string; categories: string[] }): Promise<SaveDialogResult | null> {
  let nameEl: HTMLInputElement;
  let catEl: HTMLInputElement;
  let visibility: 'private' | 'public' = 'private';

  return formModal<SaveDialogResult>(
    { title: 'Save to Cloud', confirmText: 'Save', cancelText: 'Cancel' },
    (body, submit) => {
      const field = (labelText: string): HTMLElement => {
        const wrap = document.createElement('div');
        wrap.className = 'dlg-field';
        const l = document.createElement('label');
        l.className = 'dlg-label';
        l.textContent = labelText;
        wrap.appendChild(l);
        body.appendChild(wrap);
        return wrap;
      };

      const nameWrap = field('Name');
      nameEl = document.createElement('input');
      nameEl.className = 'dlg-input';
      nameEl.type = 'text';
      nameEl.value = opts.name;
      nameEl.autocomplete = 'off';
      nameEl.spellcheck = false;
      nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      nameWrap.appendChild(nameEl);

      const catWrap = field('Category');
      catEl = document.createElement('input');
      catEl.className = 'dlg-input';
      catEl.type = 'text';
      catEl.placeholder = 'Optional — e.g. Logos, Icons';
      catEl.autocomplete = 'off';
      catEl.spellcheck = false;
      catEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      if (opts.categories.length) {
        const dlId = uid();
        const dl = document.createElement('datalist');
        dl.id = dlId;
        for (const c of opts.categories) { const o = document.createElement('option'); o.value = c; dl.appendChild(o); }
        catWrap.appendChild(dl);
        catEl.setAttribute('list', dlId);
      }
      catWrap.appendChild(catEl);

      const visWrap = field('Visibility');
      const seg = document.createElement('div');
      seg.className = 'dlg-seg';
      const mk = (val: 'private' | 'public', label: string, hint: string): HTMLButtonElement => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'dlg-seg-btn' + (val === visibility ? ' active' : '');
        b.innerHTML = `<span class="dlg-seg-label">${label}</span><span class="dlg-seg-hint">${hint}</span>`;
        b.addEventListener('click', () => {
          visibility = val;
          seg.querySelectorAll('.dlg-seg-btn').forEach(x => x.classList.toggle('active', x === b));
        });
        return b;
      };
      seg.append(
        mk('private', 'Private', 'Only you'),
        mk('public', 'Public', 'Anyone with the link'),
      );
      visWrap.appendChild(seg);

      queueMicrotask(() => { nameEl.focus(); nameEl.select(); });
    },
    () => ({
      name: nameEl.value.trim() || 'Untitled',
      category: catEl.value.trim() || null,
      visibility,
    }),
  );
}
