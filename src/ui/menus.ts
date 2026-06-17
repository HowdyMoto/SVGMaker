import type { CommandContext } from '../commands';
import { getCommand, runCommand, isEnabled, isChecked, primaryAccelerator } from '../commands';

export function setupMenus(ctx: CommandContext): void {
  const dropdowns = document.querySelectorAll('.menu-dropdown');

  dropdowns.forEach(dd => {
    const trigger = dd.querySelector('.menu-trigger')!;
    trigger.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const isOpen = dd.classList.contains('open');
      closeAllMenus();
      if (!isOpen) {
        refreshMenuItems(ctx);
        dd.classList.add('open');
      }
    });
    trigger.addEventListener('mouseenter', () => {
      const anyOpen = document.querySelector('.menu-dropdown.open');
      if (anyOpen && anyOpen !== dd) {
        closeAllMenus();
        refreshMenuItems(ctx);
        dd.classList.add('open');
      }
    });
  });

  document.addEventListener('mousedown', (e) => {
    if (!(e.target as Element).closest('.menu-dropdown')) {
      closeAllMenus();
    }
  });

  // Wire every menu button to its command and stamp the accelerator hint from
  // the registry (so the hint can never drift from the actual binding).
  document.querySelectorAll<HTMLButtonElement>('.menu-panel button[data-action]').forEach(btn => {
    const id = btn.getAttribute('data-action')!;
    const cmd = getCommand(id);
    if (!cmd) {
      if (import.meta.env.DEV) console.warn(`[menus] no command registered for data-action="${id}"`);
      return;
    }

    const accel = primaryAccelerator(cmd);
    let span = btn.querySelector('.shortcut');
    if (accel) {
      if (!span) {
        span = document.createElement('span');
        span.className = 'shortcut';
        btn.appendChild(span);
      }
      span.textContent = accel;
    } else if (span) {
      span.remove();
    }

    btn.addEventListener('click', () => {
      closeAllMenus();
      runCommand(id, ctx);
    });
  });
}

/** Reflect each item's current enabled state and (for toggles) checked state. */
function refreshMenuItems(ctx: CommandContext): void {
  document.querySelectorAll<HTMLButtonElement>('.menu-panel button[data-action]').forEach(btn => {
    const cmd = getCommand(btn.getAttribute('data-action')!);
    if (!cmd) return;
    btn.classList.toggle('disabled', !isEnabled(cmd, ctx));
    if (cmd.kind === 'toggle') btn.classList.toggle('checked', isChecked(cmd, ctx));
  });
}

function closeAllMenus(): void {
  document.querySelectorAll('.menu-dropdown').forEach(d => d.classList.remove('open'));
}
