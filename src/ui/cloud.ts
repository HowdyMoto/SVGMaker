// ---------------------------------------------------------------------------
// Cloud UI — "Save to Cloud", "Open from Cloud" (a file-browser modal), and a
// debounced autosave for the open cloud document.
//
// The dialog is built on the shared Modal primitive (ui/modal.ts). All entry
// points require sign-in and no-op cleanly when Supabase is unconfigured. The
// "which cloud row is open" state lives in lib/cloud-doc.ts so this module and
// project-file.ts can coordinate without an import cycle.
// ---------------------------------------------------------------------------

import type { AppState } from '../core/state';
import { isSignedIn, showSignInDialog } from './account';
import {
  serializeDocumentSVG, loadDocumentSVG, confirmDiscard, setProjectName,
} from './project-file';
import { openModal } from './modal';
import { confirmDialog, promptDialog, saveToCloudDialog } from './dialogs';
import { showToast as toast } from './toast';
import { getCloudDoc, setCloudDoc, setCloudDocUpdatedAt, setCloudDocName, clearCloudDoc } from '../lib/cloud-doc';
import {
  loadCloudProject, createCloudProject,
  updateCloudProject, renameCloudProject, deleteCloudProject,
  listMyProjects, listSharedWithMe, listPublicProjects, listCategories,
  setProjectVisibility, setProjectCategory,
  listShares, shareProject, unshareProject,
  ProjectConflictError, type CloudProjectMeta, type ShareRole,
} from '../lib/projects';

let appState: AppState | null = null;
let statusEl: HTMLElement | null = null;
let statusClearTimer: number | null = null;

const AUTOSAVE_IDLE_MS = 2500; // quiet period before autosaving a cloud doc
let autosaveTimer: number | null = null;
let autosaving = false;
// Set when autosave hits a concurrency conflict; pauses further autosaves (so we
// don't retry-clobber every keystroke) until an explicit Save resolves it.
let conflictBlocked = false;

/** Mount the menu-bar save-status indicator and remember the app state. */
export function setupCloud(state: AppState): void {
  appState = state;
  const menuBar = document.getElementById('menu-bar');
  if (!menuBar) return;
  statusEl = document.createElement('span');
  statusEl.id = 'cloud-status';
  statusEl.className = 'cloud-status';
  // Sit just left of the account control (which is pushed to the far right).
  const account = document.getElementById('account-area');
  if (account) menuBar.insertBefore(statusEl, account);
  else menuBar.appendChild(statusEl);
}

type Status = 'saving' | 'saved' | 'error' | 'conflict' | 'idle';
function setStatus(s: Status): void {
  if (!statusEl) return;
  if (statusClearTimer) { clearTimeout(statusClearTimer); statusClearTimer = null; }
  const label = s === 'saving' ? 'Saving…'
    : s === 'saved' ? 'All changes saved'
    : s === 'error' ? 'Save failed'
    : s === 'conflict' ? 'Changed elsewhere — not saved'
    : '';
  statusEl.textContent = label;
  // 'conflict' reuses the error styling (it's a not-saved state the user must resolve).
  const cls = s === 'conflict' ? 'error' : s;
  statusEl.className = `cloud-status ${s === 'idle' ? '' : 'show ' + cls}`;
  if (s === 'saved') {
    statusClearTimer = window.setTimeout(() => { if (statusEl) statusEl.className = 'cloud-status'; }, 2000);
  }
}

/** True if signed in; otherwise opens the sign-in dialog and returns false. */
function requireSignIn(): boolean {
  if (isSignedIn()) return true;
  showSignInDialog();
  return false;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Save the current document to the cloud. Updates the open cloud doc in place,
 * or creates a new one (prompting for a name). Also the target of ⌘S when the
 * current document is already a cloud doc.
 */
export async function saveToCloud(state: AppState): Promise<void> {
  if (!requireSignIn()) return;
  const rev = state.revision; // the version being uploaded (see markClean guard below)
  const content = serializeDocumentSVG(state);
  const { id, updatedAt } = getCloudDoc();
  try {
    setStatus('saving');
    if (id) {
      // Guard against clobbering a save made on another device. On conflict,
      // this is a user action, so it's OK to ask whether to overwrite.
      let newTs: string;
      try {
        newTs = await updateCloudProject(id, content, updatedAt ?? undefined);
      } catch (err) {
        if (err instanceof ProjectConflictError) {
          setStatus('conflict');
          const overwrite = await confirmDialog({
            title: 'Changed on another device',
            message: 'This board was updated somewhere else since you opened it. Overwrite it with your version, or keep editing and reopen it to get the newer copy?',
            confirmText: 'Overwrite',
            cancelText: 'Keep editing',
            danger: true,
          });
          if (!overwrite) { setStatus('conflict'); return; }
          newTs = await updateCloudProject(id, content); // forced (no timestamp guard)
        } else {
          throw err;
        }
      }
      setCloudDocUpdatedAt(newTs);
    } else {
      const current = document.getElementById('project-name')?.textContent?.replace(/\.svg$/i, '') || 'Untitled';
      let categories: string[] = [];
      try { categories = await listCategories(); } catch { /* offer none */ }
      const result = await saveToCloudDialog({ name: current, categories });
      if (!result) { setStatus('idle'); return; } // cancelled
      const meta = await createCloudProject(result.name, content, result.category);
      if (result.visibility === 'public') {
        try { await setProjectVisibility(meta.id, 'public'); } catch { /* best-effort */ }
      }
      setCloudDoc(meta.id, meta.name, meta.updated_at);
      setProjectName(meta.name);
    }
    conflictBlocked = false; // an explicit Save re-establishes a clean baseline
    // Only clean if nothing changed during the upload; else an edit made mid-save
    // isn't in the cloud — keep it dirty and let autosave carry it.
    if (state.revision === rev) { state.markClean(); setStatus('saved'); }
    else { noteDocumentChanged(); setStatus('idle'); }
  } catch (err) {
    setStatus('error');
    toast('Cloud save failed: ' + (err instanceof Error ? err.message : String(err)));
  }
}

/** Called on each settled document change; debounce-saves an open cloud doc. */
export function noteDocumentChanged(): void {
  const state = appState;
  if (!state) return;
  if (!getCloudDoc().id || !isSignedIn() || !state.dirty || conflictBlocked) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => { void doAutosave(); }, AUTOSAVE_IDLE_MS);
}

async function doAutosave(): Promise<void> {
  const state = appState;
  if (!state) return;
  const { id, updatedAt } = getCloudDoc();
  if (!id || autosaving || !state.dirty || !isSignedIn()) return;
  autosaving = true;
  try {
    setStatus('saving');
    // Optimistic-concurrency guarded: if the row changed on another device,
    // don't clobber it. Autosave is silent/background, so on conflict we just
    // stop and flag it (leaving the doc dirty) — the user resolves it via an
    // explicit Save, which offers to overwrite.
    const rev = state.revision; // snapshot the version we're uploading
    const newTs = await updateCloudProject(id, serializeDocumentSVG(state), updatedAt ?? undefined);
    setCloudDocUpdatedAt(newTs);
    // Only mark clean if the doc didn't change during the upload — otherwise the
    // edit made mid-await isn't in the cloud yet; leave it dirty so the already-
    // scheduled autosave uploads it (else that edit is silently lost).
    if (state.revision === rev) { state.markClean(); setStatus('saved'); }
    else { noteDocumentChanged(); setStatus('idle'); }
  } catch (err) {
    if (err instanceof ProjectConflictError) {
      conflictBlocked = true; // pause autosave until an explicit Save resolves it
      setStatus('conflict');
    } else {
      setStatus('error');
      console.warn('Cloud autosave failed:', err);
    }
  } finally {
    autosaving = false;
  }
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

type CloudTab = 'mine' | 'shared' | 'public';

/** A friendly relative time ("just now", "3 days ago"), falling back to a date. */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!then) return '';
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w} week${w === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Rendered-thumbnail cache, keyed by id + timestamp so an edited board refreshes.
// A data: URL of the board's own SVG — an <img> renders it sandboxed.
const thumbCache = new Map<string, string>();
const thumbKey = (p: CloudProjectMeta) => `${p.id}:${p.updated_at}`;

/** The Cloud Projects browser: a card grid of My Boards / Shared with me / Public,
 *  with live artwork previews, category filters, sharing, rename, delete. */
export async function openFromCloud(state: AppState): Promise<void> {
  if (!requireSignIn()) return;
  let io: IntersectionObserver | undefined; // assigned below; disconnected on any close
  const modal = openModal({
    id: 'cloud-overlay', ariaLabel: 'Cloud Projects', dialogClass: 'cloud-dialog',
    closeButton: false, onClose: () => io?.disconnect(),
  });
  if (!modal) return; // singleton already open

  modal.dialog.insertAdjacentHTML('beforeend', `
    <header class="cloud-head">
      <h1 class="cloud-title">Your work</h1>
      <div class="cloud-segmented" role="tablist">
        <button class="cloud-seg active" data-tab="mine">My boards</button>
        <button class="cloud-seg" data-tab="shared">Shared</button>
        <button class="cloud-seg" data-tab="public">Public</button>
      </div>
      <button class="cloud-x" aria-label="Close">✕</button>
    </header>
    <div class="cloud-cats"></div>
    <div class="cloud-grid" aria-live="polite"></div>
  `);
  const gridEl = modal.dialog.querySelector('.cloud-grid') as HTMLElement;
  const catsEl = modal.dialog.querySelector('.cloud-cats') as HTMLElement;
  modal.dialog.querySelector('.cloud-x')!.addEventListener('click', () => modal.close());
  let tab: CloudTab = 'mine';
  let category: string | null = null;

  // Lazy thumbnail loading: fetch each visible card's SVG and paint it, a few at
  // a time so a big library doesn't fire dozens of requests at once.
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { io!.unobserve(e.target); void loadThumb(e.target as HTMLElement); }
    }
  }, { root: gridEl, rootMargin: '120px' });
  let active = 0;
  const pending: HTMLElement[] = [];
  const pump = () => {
    while (active < 4 && pending.length) { const el = pending.shift()!; active++; void fillThumb(el).finally(() => { active--; pump(); }); }
  };
  const loadThumb = (el: HTMLElement) => { pending.push(el); pump(); };
  const fillThumb = async (el: HTMLElement): Promise<void> => {
    const id = el.dataset.id!, key = el.dataset.key!;
    const img = el.querySelector('img') as HTMLImageElement | null;
    if (!img) return;
    let url = thumbCache.get(key);
    if (!url) {
      try { const full = await loadCloudProject(id); url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(full.content); thumbCache.set(key, url); }
      catch { el.classList.add('cloud-thumb-err'); return; }
    }
    img.onload = () => el.classList.add('loaded');
    img.onerror = () => el.classList.add('cloud-thumb-err');
    img.src = url;
  };

  const openOne = async (p: CloudProjectMeta): Promise<void> => {
    if (!confirmDiscard(state)) return;
    try {
      const full = await loadCloudProject(p.id);
      loadDocumentSVG(state, full.content); // render + markClean
      const canEdit = p.owned || p.role === 'editor';
      if (canEdit) {
        setCloudDoc(full.id, full.name, full.updated_at);
        conflictBlocked = false;
        setProjectName(full.name);
      } else {
        // View-only board → open as a detached local copy the viewer can Save As.
        clearCloudDoc();
        setProjectName(`${full.name} (copy)`);
      }
      io.disconnect();
      modal.close();
    } catch (err) { toast(`Couldn’t open “${p.name}”: ${errMsg(err)}`); }
  };

  const list = (): Promise<CloudProjectMeta[]> =>
    tab === 'mine' ? listMyProjects()
    : tab === 'shared' ? listSharedWithMe()
    : listPublicProjects();

  const renderCats = async (): Promise<void> => {
    catsEl.innerHTML = '';
    if (tab !== 'mine') return;
    let cats: string[] = [];
    try { cats = await listCategories(); } catch { /* ignore */ }
    if (!cats.length) return;
    const chip = (label: string, value: string | null) => {
      const b = document.createElement('button');
      b.className = 'cloud-chip' + (category === value ? ' active' : '');
      b.textContent = label;
      b.addEventListener('click', () => { category = value; void refresh(); });
      return b;
    };
    catsEl.appendChild(chip('All', null));
    for (const c of cats) catsEl.appendChild(chip(c, c));
  };

  const skeleton = (): void => {
    gridEl.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const s = document.createElement('div');
      s.className = 'cloud-card cloud-skel';
      s.innerHTML = '<div class="cloud-thumb"></div><div class="cloud-cardmeta"><span class="cloud-skelbar"></span><span class="cloud-skelbar short"></span></div>';
      gridEl.appendChild(s);
    }
  };

  const render = async (): Promise<void> => {
    io.disconnect();
    skeleton();
    try {
      let projects = await list();
      if (tab === 'mine' && category) projects = projects.filter(p => (p.category ?? null) === category);
      if (projects.length === 0) { gridEl.innerHTML = emptyState(tab); return; }
      gridEl.innerHTML = '';
      for (const p of projects) { const card = cardFor(p); gridEl.appendChild(card); io.observe(card.querySelector('.cloud-thumb')!); }
    } catch (err) {
      gridEl.innerHTML = `<div class="cloud-empty"><p>Couldn’t load your boards.</p><span>${escapeHtml(errMsg(err))}</span></div>`;
    }
  };

  const refresh = async (): Promise<void> => { await renderCats(); await render(); };

  modal.dialog.querySelectorAll('.cloud-seg').forEach((btn) => {
    btn.addEventListener('click', () => {
      tab = (btn as HTMLElement).dataset.tab as CloudTab;
      category = null;
      modal.dialog.querySelectorAll('.cloud-seg').forEach(b => b.classList.toggle('active', b === btn));
      void refresh();
    });
  });

  const cardFor = (p: CloudProjectMeta): HTMLElement => {
    const card = document.createElement('div');
    card.className = 'cloud-card';

    const thumb = document.createElement('button');
    thumb.className = 'cloud-thumb';
    thumb.dataset.id = p.id;
    thumb.dataset.key = thumbKey(p);
    thumb.title = `Open “${p.name}”`;
    thumb.innerHTML = '<img alt="" /><span class="cloud-thumb-fallback"></span>';
    thumb.addEventListener('click', () => { void openOne(p); });
    if (p.owned && p.visibility === 'public') thumb.insertAdjacentHTML('beforeend', '<span class="cloud-pill">Public</span>');
    if (p.role) thumb.insertAdjacentHTML('beforeend', `<span class="cloud-pill">${p.role === 'editor' ? 'Can edit' : 'View only'}</span>`);
    card.appendChild(thumb);

    const meta = document.createElement('div');
    meta.className = 'cloud-cardmeta';
    const info = document.createElement('div');
    info.className = 'cloud-cardinfo';
    const name = document.createElement('div');
    name.className = 'cloud-cardname';
    name.textContent = p.name;
    const sub = document.createElement('div');
    sub.className = 'cloud-cardsub';
    sub.textContent = timeAgo(p.updated_at) + (p.category ? ` · ${p.category}` : '');
    info.append(name, sub);
    meta.appendChild(info);

    if (p.owned) {
      const more = document.createElement('button');
      more.className = 'cloud-more';
      more.setAttribute('aria-label', 'More actions');
      more.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/></svg>';
      more.addEventListener('click', (e) => { e.stopPropagation(); openCardMenu(more, p); });
      meta.appendChild(more);
    }
    card.appendChild(meta);
    return card;
  };

  const openCardMenu = (anchor: HTMLElement, p: CloudProjectMeta): void => {
    document.querySelector('.cloud-menu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'cloud-menu';
    const item = (label: string, fn: () => void, danger = false) => {
      const b = document.createElement('button');
      b.className = 'cloud-menu-item' + (danger ? ' danger' : '');
      b.textContent = label;
      b.addEventListener('click', () => { menu.remove(); fn(); });
      menu.appendChild(b);
    };
    const isPublic = p.visibility === 'public';
    item(isPublic ? 'Make private' : 'Make public', async () => {
      try { await setProjectVisibility(p.id, isPublic ? 'private' : 'public'); await render(); }
      catch (err) { toast('Failed: ' + errMsg(err)); }
    });
    item('Share…', () => openShareDialog(p.id, p.name));
    item('Rename…', async () => {
      const next = await promptDialog({ title: 'Rename board', label: 'Name', value: p.name, confirmText: 'Rename' });
      if (next === null || !next || next === p.name) return;
      try {
        const ts = await renameCloudProject(p.id, next);
        if (getCloudDoc().id === p.id) { setCloudDocName(next); setCloudDocUpdatedAt(ts); setProjectName(next); }
        await render();
      } catch (err) { toast('Rename failed: ' + errMsg(err)); }
    });
    item('Set category…', async () => {
      let categories: string[] = [];
      try { categories = await listCategories(); } catch { /* none */ }
      const c = await promptDialog({ title: 'Set category', label: 'Category', value: p.category ?? '', placeholder: 'Blank to clear', suggestions: categories, confirmText: 'Save' });
      if (c === null) return;
      try { await setProjectCategory(p.id, c || null); await refresh(); }
      catch (err) { toast('Failed: ' + errMsg(err)); }
    });
    item('Delete', async () => {
      const ok = await confirmDialog({ title: `Delete “${p.name}”?`, message: 'This permanently removes the board and can’t be undone.', confirmText: 'Delete', danger: true });
      if (!ok) return;
      try {
        await deleteCloudProject(p.id);
        if (getCloudDoc().id === p.id) clearCloudDoc();
        await render();
      } catch (err) { toast('Delete failed: ' + errMsg(err)); }
    }, true);

    modal.dialog.appendChild(menu);
    const a = anchor.getBoundingClientRect();
    const d = modal.dialog.getBoundingClientRect();
    menu.style.top = `${a.bottom - d.top + 4}px`;
    menu.style.right = `${d.right - a.right}px`;
    const off = (e: MouseEvent) => { if (!menu.contains(e.target as Node) && e.target !== anchor) { menu.remove(); document.removeEventListener('mousedown', off, true); } };
    setTimeout(() => document.addEventListener('mousedown', off, true), 0);
  };

  void refresh();
}

function emptyState(tab: CloudTab): string {
  const [title, sub] = tab === 'mine'
    ? ['Nothing saved yet', 'Use “Save to Cloud” to keep your work here and open it anywhere.']
    : tab === 'shared' ? ['Nothing shared with you', 'Boards other people share with you will show up here.']
    : ['No public boards yet', 'Public boards from the community will appear here.'];
  return `<div class="cloud-empty"><svg viewBox="0 0 48 48" width="48" height="48" class="cloud-empty-ico"><path d="M14 30a8 8 0 0 1 .8-16 11 11 0 0 1 21 3 7 7 0 0 1-1.8 13H14z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><p>${title}</p><span>${sub}</span></div>`;
}

/** Share dialog: list collaborators, invite by email with a role, change/remove. */
export function openShareDialog(projectId: string, name: string): void {
  const modal = openModal({ id: 'share-overlay', ariaLabel: 'Share project', dialogClass: 'share-dialog' });
  if (!modal) return;
  modal.dialog.insertAdjacentHTML('beforeend', `
    <h1 class="cloud-title">Share “${escapeHtml(name)}”</h1>
    <p class="share-hint">Invite specific BuzzQuill users. Boards are private until you add people or make them public.</p>
    <div class="share-add">
      <input type="email" class="share-email" placeholder="teammate@email.com" autocomplete="off" />
      <select class="share-role">
        <option value="viewer">Can view</option>
        <option value="editor">Can edit</option>
      </select>
      <button class="share-invite">Invite</button>
    </div>
    <div class="share-msg" aria-live="polite"></div>
    <div class="share-list" aria-live="polite">Loading…</div>
  `);
  const listEl = modal.dialog.querySelector('.share-list') as HTMLElement;
  const emailEl = modal.dialog.querySelector('.share-email') as HTMLInputElement;
  const roleEl = modal.dialog.querySelector('.share-role') as HTMLSelectElement;
  const msgEl = modal.dialog.querySelector('.share-msg') as HTMLElement;

  const renderShares = async (): Promise<void> => {
    try {
      const shares = await listShares(projectId);
      if (!shares.length) { listEl.innerHTML = '<div class="cloud-empty">No collaborators yet.</div>'; return; }
      listEl.innerHTML = '';
      for (const sh of shares) {
        const row = document.createElement('div');
        row.className = 'share-row';
        row.innerHTML = `
          <span class="share-who"></span>
          <select class="share-row-role">
            <option value="viewer">Can view</option>
            <option value="editor">Can edit</option>
          </select>
          <button class="share-remove">Remove</button>`;
        (row.querySelector('.share-who') as HTMLElement).textContent = sh.grantee_email ?? sh.grantee_id;
        (row.querySelector('.share-row-role') as HTMLSelectElement).value = sh.role;
        row.querySelector('.share-row-role')!.addEventListener('change', async (e) => {
          const role = (e.target as HTMLSelectElement).value as ShareRole;
          try { await shareProject(projectId, sh.grantee_email ?? '', role); } catch (err) { msgEl.textContent = errMsg(err); }
        });
        row.querySelector('.share-remove')!.addEventListener('click', async () => {
          try { await unshareProject(projectId, sh.grantee_id); await renderShares(); }
          catch (err) { msgEl.textContent = errMsg(err); }
        });
        listEl.appendChild(row);
      }
    } catch (err) {
      listEl.innerHTML = `<div class="cloud-empty">Failed to load: ${escapeHtml(errMsg(err))}</div>`;
    }
  };

  modal.dialog.querySelector('.share-invite')!.addEventListener('click', async () => {
    const email = emailEl.value.trim();
    if (!email) return;
    msgEl.textContent = 'Inviting…';
    try {
      await shareProject(projectId, email, roleEl.value as ShareRole);
      emailEl.value = '';
      msgEl.textContent = '';
      await renderShares();
    } catch (err) { msgEl.textContent = errMsg(err); }
  });

  void renderShares();
}
