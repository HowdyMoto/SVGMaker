import { formatAccelerator } from "../commands";

/**
 * A simple, dismissible "About SVGMaker" modal. Self-contained like
 * showExportDialog(): it builds its own overlay, owns its lifecycle, and tears
 * everything down on close. Reached via the Help menu and the command palette
 * (see the `app.about` command in commands.ts).
 */
export function showAboutDialog(): void {
  // Singleton — never stack two About dialogs (e.g. menu click + ⌘K).
  if (document.getElementById("about-overlay")) return;

  const prevFocus = document.activeElement as HTMLElement | null;

  const overlay = document.createElement("div");
  overlay.id = "about-overlay";
  overlay.className = "about-overlay";

  const dialog = document.createElement("div");
  dialog.className = "about-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "About SVGMaker");

  const iconSrc = `${import.meta.env.BASE_URL}icon.svg`;
  const kbdHint = formatAccelerator("Mod+K");

  dialog.innerHTML = `
    <button class="about-close" aria-label="Close">✕</button>
    <img class="about-logo" src="${iconSrc}" alt="" width="72" height="72" />
    <h1 class="about-title">SVGMaker</h1>
    <div class="about-version">Version ${__APP_VERSION__}</div>
    <p class="about-tagline">A browser-based SVG editor.</p>
  
    <div class="about-hint">Press <kbd>${kbdHint}</kbd> to search every command.</div>
    <div class="about-copyright">© 2026 · All rights reserved. WrightGeist LLC</div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const close = (): void => {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    prevFocus?.focus?.();
  };

  // Capture phase so this pre-empts the global shortcut handler in main.ts —
  // otherwise a stray tool key (e.g. "V") would switch tools behind the modal.
  // Escape closes; everything else is swallowed while the dialog is open.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
    e.stopPropagation();
  };
  document.addEventListener("keydown", onKey, true);

  dialog.querySelector(".about-close")!.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });

  (dialog.querySelector(".about-close") as HTMLButtonElement).focus();
}
