/** Shared helpers for the side-panel lists: right-click menu + inline rename. */

export interface ContextMenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
}

let activeMenu: HTMLElement | null = null;

function onDocMouseDown(e: MouseEvent): void {
  if (activeMenu && !activeMenu.contains(e.target as Node)) closeContextMenu();
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeContextMenu();
}

export function closeContextMenu(): void {
  if (!activeMenu) return;
  activeMenu.remove();
  activeMenu = null;
  document.removeEventListener('mousedown', onDocMouseDown, true);
  document.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('blur', closeContextMenu);
}

export function showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
  closeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  for (const item of items) {
    const btn = document.createElement('button');
    btn.className = 'context-menu-item';
    if (item.danger) btn.classList.add('danger');
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      closeContextMenu();
      item.action();
    });
    menu.appendChild(btn);
  }

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);
  activeMenu = menu;

  // Nudge back into the viewport if it would overflow.
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;

  // Defer listeners so the opening click/contextmenu doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', closeContextMenu);
  }, 0);
}

/**
 * Replace a name label with a text input for inline renaming. `commit` is
 * called with the final name (the original name if the edit is cancelled).
 */
export function beginInlineRename(
  nameEl: HTMLElement,
  current: string,
  commit: (name: string) => void,
): void {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = current;
  input.className = 'layer-rename';
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    commit(save ? (input.value.trim() || current) : current);
  };

  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // don't trigger global shortcuts while typing
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); input.blur(); }
  });
}
