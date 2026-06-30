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
import { googleLogo, discordLogo, cloudUploadIcon } from './brand-icons';

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

/** First letter of a name for the avatar badge (falls back to a person glyph). */
function initial(name: string): string {
  const ch = name.trim()[0];
  return ch ? ch.toUpperCase() : '·';
}

/** Deterministic, pleasant hue from a string so each user gets a stable colour. */
function hueFor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** Avatar badge markup: a coloured circle with the user's initial. */
function avatarMarkup(name: string): string {
  const bg = `hsl(${hueFor(name)} 52% 45%)`;
  return `<span class="account-avatar" style="background:${bg}" aria-hidden="true">${initial(name)}</span>`;
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
      const name = displayName(currentUser);
      btn.className = 'account-chip';
      btn.innerHTML = `${avatarMarkup(name)}<span class="account-name"></span>`;
      btn.querySelector('.account-name')!.textContent = name; // textContent = safe
      btn.title = currentUser.email ?? 'Account';
      btn.setAttribute('aria-label', `Account: ${name}`);
    } else {
      btn.className = 'account-cta';
      btn.innerHTML = `<span class="account-cta-icon">${cloudUploadIcon}</span><span>Sign In</span>`;
      btn.title = 'Sign in to save & sync your projects';
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
  dialog.tabIndex = -1; // focus target on open — avoids a stray ring on a button
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Sign in to BuzzQuill');

  dialog.innerHTML = `
    <button class="about-close" aria-label="Close">✕</button>
    <h1 class="about-title">Welcome to BuzzQuill</h1>
    <p class="about-tagline">Sign in to save your work and sync projects across devices.</p>
    <div class="signin-providers">
      <button class="signin-provider signin-provider--google" data-provider="google">
        <span class="signin-provider-logo">${googleLogo}</span>
        <span class="signin-provider-label">Continue with Google</span>
        <span class="signin-spinner" aria-hidden="true"></span>
      </button>
      <button class="signin-provider signin-provider--discord" data-provider="discord">
        <span class="signin-provider-logo">${discordLogo}</span>
        <span class="signin-provider-label">Continue with Discord</span>
        <span class="signin-spinner" aria-hidden="true"></span>
      </button>
    </div>
    <div class="signin-error" hidden></div>
    <p class="signin-fineprint">We only use this to identify your account.</p>
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
  const providerBtns = dialog.querySelectorAll<HTMLButtonElement>('.signin-provider');
  providerBtns.forEach((b) => {
    b.addEventListener('click', async () => {
      const provider = b.getAttribute('data-provider') as OAuthProvider;
      errBox.hidden = true;
      // Lock the whole set; spotlight the chosen one with a spinner.
      providerBtns.forEach(x => (x.disabled = true));
      b.classList.add('is-loading');
      b.setAttribute('aria-busy', 'true');
      try {
        // Navigates away to the provider on success; control won't return here.
        await signInWith(provider);
      } catch (err) {
        errBox.textContent = err instanceof Error ? err.message : 'Sign-in failed. Is this provider enabled in Supabase?';
        errBox.hidden = false;
        b.classList.remove('is-loading');
        b.removeAttribute('aria-busy');
        providerBtns.forEach(x => (x.disabled = false));
      }
    });
  });

  dialog.focus({ preventScroll: true });
}
