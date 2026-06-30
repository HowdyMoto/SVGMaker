// ---------------------------------------------------------------------------
// Contact-form modal. Self-contained like about-dialog.ts / legal.ts: own
// overlay, Escape / click-outside to close, capture-phase key handling.
//
// Submissions go to Supabase (see lib/contact.ts), so no email address is
// exposed in the app. Includes a honeypot field for basic bot filtering.
// ---------------------------------------------------------------------------

import { submitContactMessage } from '../lib/contact';
import { isAuthConfigured } from '../lib/supabase';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function showContactDialog(): void {
  if (document.getElementById('contact-overlay')) return; // singleton

  const prevFocus = document.activeElement as HTMLElement | null;

  const overlay = document.createElement('div');
  overlay.id = 'contact-overlay';
  overlay.className = 'about-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'about-dialog contact-dialog';
  dialog.tabIndex = -1;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Contact us');

  const formMarkup = `
    <form class="contact-form" novalidate>
      <label class="contact-field">
        <span>Email <span class="contact-optional">(optional, so we can reply)</span></span>
        <input type="email" name="email" autocomplete="email" placeholder="you@example.com" />
      </label>
      <label class="contact-field">
        <span>Message</span>
        <textarea name="message" rows="5" maxlength="5000" required placeholder="How can we help?"></textarea>
      </label>
      <input type="text" name="website" class="contact-hp" tabindex="-1" autocomplete="off" aria-hidden="true" />
      <div class="contact-error" role="alert" hidden></div>
      <button type="submit" class="contact-submit">Send message</button>
    </form>`;

  const unavailable = `<p class="contact-unavailable">The contact form isn't available in this build. Please try again from the live app.</p>`;

  dialog.innerHTML = `
    <button class="about-close" aria-label="Close">✕</button>
    <h1 class="about-title">Contact us</h1>
    <p class="about-tagline">Questions, bugs, or feedback? Send us a note.</p>
    ${isAuthConfigured ? formMarkup : unavailable}
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const close = (): void => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    prevFocus?.focus?.();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);

  dialog.querySelector('.about-close')!.addEventListener('click', close);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

  const form = dialog.querySelector('.contact-form') as HTMLFormElement | null;
  if (form) {
    const errBox = form.querySelector('.contact-error') as HTMLElement;
    const emailInput = form.querySelector('[name="email"]') as HTMLInputElement;
    const messageInput = form.querySelector('[name="message"]') as HTMLTextAreaElement;
    const honeypot = form.querySelector('[name="website"]') as HTMLInputElement;
    const submitBtn = form.querySelector('.contact-submit') as HTMLButtonElement;

    const fail = (msg: string): void => { errBox.textContent = msg; errBox.hidden = false; };

    const succeed = (): void => {
      dialog.querySelector('.about-tagline')?.remove();
      form.replaceWith(Object.assign(document.createElement('p'), {
        className: 'contact-thanks',
        textContent: 'Thanks! Your message has been sent.',
      }));
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.hidden = true;

      if (honeypot.value) { succeed(); return; } // bot trap — pretend success

      const message = messageInput.value.trim();
      if (!message) { fail('Please enter a message.'); messageInput.focus(); return; }
      const email = emailInput.value.trim();
      if (email && !EMAIL_RE.test(email)) { fail('Please enter a valid email, or leave it blank.'); emailInput.focus(); return; }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      try {
        await submitContactMessage({ email, message });
        succeed();
      } catch (err) {
        fail(err instanceof Error ? err.message : 'Could not send your message. Please try again later.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send message';
      }
    });

    (form.querySelector('[name="email"]') as HTMLInputElement).focus({ preventScroll: true });
  } else {
    dialog.focus({ preventScroll: true });
  }
}
