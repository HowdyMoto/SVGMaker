// ---------------------------------------------------------------------------
// Privacy Policy + Terms of Service modal.
//
// Self-contained like about-dialog.ts: own overlay, Escape / click-outside to
// close, capture-phase key handling so canvas shortcuts can't fire behind it.
// Deliberately plain and short — edit the copy below (and CONTACT_EMAIL) as the
// product matures. Not legal advice; a simple, honest starting point.
// ---------------------------------------------------------------------------

import { showContactDialog } from './contact-dialog';

const EFFECTIVE = 'June 30, 2026';
const CONTACT_LINK = `<button type="button" class="legal-contact-link">contact form</button>`;

const PRIVACY = `
  <h2>Privacy Policy</h2>
  <p class="legal-date">Effective ${EFFECTIVE}</p>
  <p>BuzzQuill is a browser-based vector editor. Your drawings are created and
  kept in your browser — we don't see or collect them unless you choose to save a
  project to the cloud.</p>
  <h3>What we collect</h3>
  <p>Signing in is optional. If you do, we receive your name, email address, and
  profile picture from your chosen provider (Google or Discord) to create and
  identify your account. If you save a project to the cloud, that project's
  contents are stored for you by our hosting provider.</p>
  <h3>How we use it</h3>
  <p>Only to sign you in and to store and sync your projects. We do not sell your
  data or use it for advertising.</p>
  <h3>Local storage</h3>
  <p>Preferences and your recent-files list live in your browser (localStorage and
  IndexedDB) and never leave your device.</p>
  <h3>Service providers</h3>
  <p>We use Supabase for authentication and storage, and Google or Discord for
  sign-in. Their handling of your data is governed by their own policies.</p>
  <h3>Your choices</h3>
  <p>You can delete any saved project at any time, or request deletion of your
  account and associated data through our ${CONTACT_LINK}.</p>
`;

const TERMS = `
  <h2>Terms of Service</h2>
  <p class="legal-date">Effective ${EFFECTIVE}</p>
  <p>By using BuzzQuill, you agree to these terms. If you don't agree, please
  don't use the app.</p>
  <h3>Your content</h3>
  <p>You keep all rights to the artwork you create. You're responsible for what
  you make and store, and you agree not to use BuzzQuill for unlawful content or
  to infringe others' rights.</p>
  <h3>Your account</h3>
  <p>Keep your sign-in secure; you're responsible for activity under your
  account.</p>
  <h3>Availability &amp; warranty</h3>
  <p>BuzzQuill is provided "as is" and "as available", without warranties of any
  kind. We may change, suspend, or discontinue features at any time. Keep your own
  backups by exporting your files — we're not responsible for lost work.</p>
  <h3>Limitation of liability</h3>
  <p>To the maximum extent permitted by law, WrightGeist LLC is not liable for any
  indirect or consequential damages arising from your use of BuzzQuill.</p>
  <h3>Changes</h3>
  <p>We may update these terms; continued use after a change means you accept it.
  Questions? Reach us through our ${CONTACT_LINK}.</p>
`;

/** Open the legal modal, scrolled to the requested section. */
export function showLegalDialog(section: 'privacy' | 'terms' = 'privacy'): void {
  if (document.getElementById('legal-overlay')) return; // singleton

  const prevFocus = document.activeElement as HTMLElement | null;

  const overlay = document.createElement('div');
  overlay.id = 'legal-overlay';
  overlay.className = 'about-overlay'; // reuse the dimmed full-screen backdrop

  const dialog = document.createElement('div');
  dialog.className = 'about-dialog legal-dialog';
  dialog.tabIndex = -1;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Privacy Policy and Terms of Service');

  dialog.innerHTML = `
    <button class="about-close" aria-label="Close">✕</button>
    <h1 class="about-title legal-heading">Privacy &amp; Terms</h1>
    <nav class="legal-tabs">
      <button type="button" class="legal-tab" data-goto="privacy">Privacy Policy</button>
      <button type="button" class="legal-tab" data-goto="terms">Terms of Service</button>
    </nav>
    <div class="legal-body">
      <section id="legal-privacy">${PRIVACY}</section>
      <section id="legal-terms">${TERMS}</section>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const body = dialog.querySelector('.legal-body') as HTMLElement;
  const goTo = (which: string): void => {
    const target = dialog.querySelector(`#legal-${which}`) as HTMLElement | null;
    if (target) body.scrollTop = target.offsetTop - body.offsetTop;
  };
  dialog.querySelectorAll<HTMLButtonElement>('.legal-tab').forEach((tab) =>
    tab.addEventListener('click', () => goTo(tab.dataset.goto!)));

  const close = (): void => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    prevFocus?.focus?.();
  };

  // Capture phase so this pre-empts canvas shortcuts (and any modal underneath,
  // e.g. the sign-in dialog, which yields to us while #legal-overlay exists). We
  // in turn yield to the contact dialog when it's stacked on top of us.
  const onKey = (e: KeyboardEvent): void => {
    if (document.getElementById('contact-overlay')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);

  dialog.querySelector('.about-close')!.addEventListener('click', close);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

  // "contact form" links inside the policy text open the contact modal on top.
  dialog.querySelectorAll('.legal-contact-link').forEach((link) =>
    link.addEventListener('click', () => showContactDialog()));

  dialog.focus({ preventScroll: true });
  goTo(section);
}
