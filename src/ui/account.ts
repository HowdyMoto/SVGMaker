// ---------------------------------------------------------------------------
// Account UI — the menu-bar sign-in control and the sign-in modal.
//
// Self-contained like about-dialog.ts: builds its own DOM, owns its lifecycle.
// When Supabase is unconfigured this module renders NOTHING and every entry
// point is inert, so the editor is visually and behaviourally identical to its
// pre-auth self until VITE_SUPABASE_* are provided.
// ---------------------------------------------------------------------------

import type { User } from '@supabase/supabase-js';
import { isAuthConfigured } from '../lib/supabase';
import { signInWith, signOut, onAuthChange, displayName, type OAuthProvider } from '../lib/auth';

/** Last known user, kept in sync via onAuthChange. Drives command enablement. */
let currentUser: User | null = null;

/** True when a user is signed in. Used by the command registry to gate items. */
export function isSignedIn(): boolean {
  return currentUser !== null;
}

/** Sign out (no-op when unconfigured / already signed out). */
export async function signOutUser(): Promise<void> {
  await signOut();
}

/**
 * Mount the account control into the menu bar and keep it in sync with auth
 * state. Safe to call once from main.ts; returns early when unconfigured.
 */
export function setupAccountUI(): void {
  if (!isAuthConfigured) return;

  const menuBar = document.getElementById('menu-bar');
  if (!menuBar) return;

  const area = document.createElement('div');
  area.id = 'account-area';
  menuBar.appendChild(area);

  const btn = document.createElement('button');
  btn.id = 'account-btn';
  btn.type = 'button';
  area.appendChild(btn);

  const render = (): void => {
    if (currentUser) {
      btn.textContent = displayName(currentUser);
      btn.title = currentUser.email ?? 'Account';
      btn.setAttribute('aria-label', `Account: ${displayName(currentUser)}`);
    } else {
      btn.textContent = 'Sign In';
      btn.title = 'Sign in to your account';
      btn.setAttribute('aria-label', 'Sign in');
    }
  };

  btn.addEventListener('click', () => {
    if (currentUser) openAccountPopover(area, btn);
    else showSignInDialog();
  });

  onAuthChange((user) => {
    currentUser = user;
    render();
  });

  render();
}

/** Small popover anchored under the account button: email + Sign out. */
function openAccountPopover(anchor: HTMLElement, btn: HTMLElement): void {
  // Toggle off if already open — and run its stored cleanup so the outside-click
  // listener it registered is removed too (otherwise it would leak each toggle).
  const existing = document.getElementById('account-popover') as (HTMLElement & { _close?: () => void }) | null;
  if (existing) { (existing._close ?? (() => existing.remove()))(); return; }

  const pop = document.createElement('div') as HTMLElement & { _close?: () => void };
  pop.id = 'account-popover';
  pop.className = 'account-popover';
  pop.setAttribute('role', 'menu');

  const email = document.createElement('div');
  email.className = 'account-popover-email';
  email.textContent = currentUser?.email ?? 'Signed in';
  pop.appendChild(email);

  const signOutBtn = document.createElement('button');
  signOutBtn.type = 'button';
  signOutBtn.className = 'account-popover-item';
  signOutBtn.textContent = 'Sign Out';
  signOutBtn.addEventListener('click', () => {
    close();
    void signOutUser();
  });
  pop.appendChild(signOutBtn);

  anchor.appendChild(pop);

  const close = (): void => {
    document.removeEventListener('mousedown', onAway, true);
    pop.remove();
  };
  pop._close = close; // let the toggle-off path above clean up this listener
  // Close on any click outside the popover/button.
  const onAway = (e: MouseEvent): void => {
    const t = e.target as Node;
    if (!pop.contains(t) && t !== btn) close();
  };
  // Defer so the click that opened it doesn't immediately close it.
  setTimeout(() => document.addEventListener('mousedown', onAway, true), 0);
}

/**
 * The sign-in modal. Mirrors showAboutDialog(): own overlay, Escape to close,
 * capture-phase key handling so canvas shortcuts can't fire behind it.
 */
export function showSignInDialog(): void {
  if (!isAuthConfigured) return;
  if (document.getElementById('signin-overlay')) return; // singleton

  const prevFocus = document.activeElement as HTMLElement | null;

  const overlay = document.createElement('div');
  overlay.id = 'signin-overlay';
  overlay.className = 'about-overlay'; // reuse the dimmed full-screen backdrop

  const dialog = document.createElement('div');
  dialog.className = 'about-dialog signin-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Sign in to SVGMaker');

  dialog.innerHTML = `
    <button class="about-close" aria-label="Close">✕</button>
    <h1 class="about-title">Sign In</h1>
    <p class="about-tagline">Save and sync your projects across devices.</p>
    <div class="signin-providers">
      <button class="signin-provider" data-provider="google">Continue with Google</button>
      <button class="signin-provider" data-provider="github">Continue with GitHub</button>
    </div>
    <div class="signin-error" hidden></div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const close = (): void => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    prevFocus?.focus?.();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    e.stopPropagation(); // swallow canvas shortcuts while the modal is up
  };
  document.addEventListener('keydown', onKey, true);

  dialog.querySelector('.about-close')!.addEventListener('click', close);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

  const errBox = dialog.querySelector('.signin-error') as HTMLElement;
  dialog.querySelectorAll<HTMLButtonElement>('.signin-provider').forEach((b) => {
    b.addEventListener('click', async () => {
      const provider = b.getAttribute('data-provider') as OAuthProvider;
      errBox.hidden = true;
      dialog.querySelectorAll<HTMLButtonElement>('.signin-provider').forEach(x => (x.disabled = true));
      try {
        // Navigates away to the provider on success; control won't return here.
        await signInWith(provider);
      } catch (err) {
        errBox.textContent = err instanceof Error ? err.message : 'Sign-in failed. Is this provider enabled in Supabase?';
        errBox.hidden = false;
        dialog.querySelectorAll<HTMLButtonElement>('.signin-provider').forEach(x => (x.disabled = false));
      }
    });
  });

  (dialog.querySelector('.about-close') as HTMLButtonElement).focus();
}
