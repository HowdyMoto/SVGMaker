// ---------------------------------------------------------------------------
// Modal — the one reusable centered-dialog primitive.
//
// Before this, every dialog (About, Export, sign-in, …) re-implemented the same
// lifecycle by hand — backdrop, Escape-to-close, click-outside, focus capture &
// restore, a singleton guard, and an ad-hoc z-index — and some (Export) silently
// omitted half of it. openModal() owns all of that once, so a new dialog is just
// its content. Styling lives in the token-based `.modal-*` classes in style.css.
//
// Scope: centered modal dialogs. Anchored popovers (color picker, command
// palette, account menu) have their own positioning and are intentionally not
// built on this.
// ---------------------------------------------------------------------------

export interface ModalOptions {
  /** Singleton guard: if an element with this id already exists, openModal is a
   *  no-op and returns null (prevents stacking, e.g. menu click + ⌘K). */
  id?: string;
  /** Accessible name for the dialog (aria-label). */
  ariaLabel: string;
  /** Extra class(es) on the dialog box for size/padding/content-specific styling
   *  (e.g. 'about-dialog'). The shared surface comes from `.modal-dialog`. */
  dialogClass?: string;
  /** Render the ✕ close button in the corner (default true). */
  closeButton?: boolean;
  /** Run on close (after teardown) — e.g. to drop external listeners. */
  onClose?: () => void;
}

export interface ModalHandle {
  overlay: HTMLElement;
  /** The dialog box — append your content here. */
  dialog: HTMLElement;
  /** Close and tear down (idempotent). */
  close: () => void;
}

/**
 * Open a centered modal dialog. Returns a handle whose `dialog` you fill with
 * content, or null if a singleton with the same `id` is already open.
 */
export function openModal(opts: ModalOptions): ModalHandle | null {
  if (opts.id && document.getElementById(opts.id)) return null; // already open

  const prevFocus = document.activeElement as HTMLElement | null;

  const overlay = document.createElement('div');
  if (opts.id) overlay.id = opts.id;
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = opts.dialogClass ? `modal-dialog ${opts.dialogClass}` : 'modal-dialog';
  dialog.tabIndex = -1; // focus target on open — avoids a stray ring on a control
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', opts.ariaLabel);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    prevFocus?.focus?.();
    opts.onClose?.();
  };

  // Capture phase so this pre-empts the global shortcut handler in main.ts:
  // stray/destructive keys (a tool key, Delete on a shape behind the modal) must
  // not fire while the dialog is up. Escape closes; everything else is swallowed.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);

  if (opts.closeButton !== false) {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', close);
    dialog.appendChild(closeBtn);
  }

  // Click on the backdrop (but not the dialog) dismisses.
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  dialog.focus();

  return { overlay, dialog, close };
}
