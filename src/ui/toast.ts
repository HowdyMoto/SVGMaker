/**
 * Lightweight transient notifications (toasts).
 *
 * Used to tell the user about non-fatal import caveats — e.g. an opened SVG used
 * a feature BuzzQuill doesn't support and it was dropped. Self-contained (injects
 * its own styles) and non-blocking, unlike `alert()`.
 */

const STYLE_ID = 'toast-style';
let container: HTMLElement | null = null;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .toast-stack {
      position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
      z-index: 11000; display: flex; flex-direction: column; gap: 8px;
      align-items: center; pointer-events: none;
      font-family: 'Segoe UI', system-ui, sans-serif;
    }
    .toast {
      pointer-events: auto; max-width: 460px;
      display: flex; align-items: flex-start; gap: 10px;
      padding: 11px 14px; border-radius: 8px;
      background: #3c3c3c; border: 1px solid #555; color: #e8e8e8;
      box-shadow: 0 8px 28px rgba(0,0,0,0.45); font-size: 12.5px; line-height: 1.4;
      opacity: 0; transform: translateY(8px); transition: opacity .18s ease, transform .18s ease;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
    .toast-icon { flex: none; margin-top: 1px; color: #f0c040; }
    .toast-msg { flex: 1 1 auto; }
    .toast-close {
      flex: none; background: none; border: none; color: #999; cursor: pointer;
      font-size: 15px; line-height: 1; padding: 0 2px;
    }
    .toast-close:hover { color: #ddd; }
  `;
  document.head.appendChild(style);
}

function ensureContainer(): HTMLElement {
  if (container) return container;
  ensureStyles();
  container = document.createElement('div');
  container.className = 'toast-stack';
  document.body.appendChild(container);
  return container;
}

const WARN_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

/** Show a transient toast. Auto-dismisses after `durationMs` (0 = until closed). */
export function showToast(message: string, durationMs = 8000): void {
  const stack = ensureContainer();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.innerHTML = WARN_ICON;

  const msg = document.createElement('span');
  msg.className = 'toast-msg';
  msg.textContent = message;

  const close = document.createElement('button');
  close.className = 'toast-close';
  close.textContent = '✕';
  close.title = 'Dismiss';

  const dismiss = () => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  };
  close.addEventListener('click', dismiss);

  toast.append(icon, msg, close);
  stack.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  if (durationMs > 0) setTimeout(dismiss, durationMs);
}
