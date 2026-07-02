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
          const overwrite = window.confirm(
            'This project was changed on another device since you opened it.\n\n' +
            'OK = overwrite it with your version.\n' +
            'Cancel = keep editing (reopen it from the cloud to get the other version).',
          );
          if (!overwrite) { setStatus('conflict'); return; }
          newTs = await updateCloudProject(id, content); // forced (no timestamp guard)
        } else {
          throw err;
        }
      }
      setCloudDocUpdatedAt(newTs);
    } else {
      const current = document.getElementById('project-name')?.textContent?.replace(/\.svg$/i, '') || 'Untitled';
      const name = window.prompt('Save to cloud as:', current);
      if (name === null) { setStatus('idle'); return; } // cancelled
      const meta = await createCloudProject(name.trim() || 'Untitled', content);
      setCloudDoc(meta.id, meta.name, meta.updated_at);
      setProjectName(meta.name);
    }
    conflictBlocked = false; // an explicit Save re-establishes a clean baseline
    state.markClean();
    setStatus('saved');
  } catch (err) {
    setStatus('error');
    alert('Cloud save failed: ' + (err instanceof Error ? err.message : String(err)));
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
    const newTs = await updateCloudProject(id, serializeDocumentSVG(state), updatedAt ?? undefined);
    setCloudDocUpdatedAt(newTs);
    state.markClean();
    setStatus('saved');
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

/** The Cloud Projects browser: My Boards / Shared with me / Public, with category
 *  filters, per-board visibility toggle, sharing, rename, and delete. */
export async function openFromCloud(state: AppState): Promise<void> {
  if (!requireSignIn()) return;
  const modal = openModal({ id: 'cloud-overlay', ariaLabel: 'Cloud Projects', dialogClass: 'cloud-dialog' });
  if (!modal) return; // singleton already open

  modal.dialog.insertAdjacentHTML('beforeend', `
    <h1 class="cloud-title">Cloud Projects</h1>
    <div class="cloud-tabs" role="tablist">
      <button class="cloud-tab active" data-tab="mine">My Boards</button>
      <button class="cloud-tab" data-tab="shared">Shared with me</button>
      <button class="cloud-tab" data-tab="public">Public</button>
    </div>
    <div class="cloud-cats"></div>
    <div class="cloud-list" aria-live="polite">Loading…</div>
  `);
  const listEl = modal.dialog.querySelector('.cloud-list') as HTMLElement;
  const catsEl = modal.dialog.querySelector('.cloud-cats') as HTMLElement;
  let tab: CloudTab = 'mine';
  let category: string | null = null;

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
      modal.close();
    } catch (err) { alert('Open failed: ' + errMsg(err)); }
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

  const render = async (): Promise<void> => {
    try {
      let projects = await list();
      if (tab === 'mine' && category) projects = projects.filter(p => (p.category ?? null) === category);
      if (projects.length === 0) {
        listEl.innerHTML = `<div class="cloud-empty">${tab === 'mine'
          ? 'No boards yet. Use “Save to Cloud” to add one.'
          : tab === 'shared' ? 'Nothing shared with you yet.' : 'No public boards yet.'}</div>`;
        return;
      }
      listEl.innerHTML = '';
      for (const p of projects) listEl.appendChild(rowFor(p));
    } catch (err) {
      listEl.innerHTML = `<div class="cloud-empty">Failed to load: ${escapeHtml(errMsg(err))}</div>`;
    }
  };

  const refresh = async (): Promise<void> => { await renderCats(); await render(); };

  modal.dialog.querySelectorAll('.cloud-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      tab = (btn as HTMLElement).dataset.tab as CloudTab;
      category = null;
      modal.dialog.querySelectorAll('.cloud-tab').forEach(b => b.classList.toggle('active', b === btn));
      void refresh();
    });
  });

  const rowFor = (p: CloudProjectMeta): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'cloud-row';
    const badges: string[] = [];
    if (p.category) badges.push(`<span class="cloud-badge">${escapeHtml(p.category)}</span>`);
    if (p.role) badges.push(`<span class="cloud-badge">${p.role === 'editor' ? 'Can edit' : 'View only'}</span>`);
    if (tab === 'public' && p.owned) badges.push('<span class="cloud-badge">Yours</span>');
    row.innerHTML = `
      <button class="cloud-open" title="Open this board">
        <span class="cloud-name"></span>
        <span class="cloud-when"></span>
      </button>
      <span class="cloud-badges">${badges.join('')}</span>
      <span class="cloud-actions"></span>`;
    (row.querySelector('.cloud-name') as HTMLElement).textContent = p.name;
    (row.querySelector('.cloud-when') as HTMLElement).textContent = new Date(p.updated_at).toLocaleDateString();
    row.querySelector('.cloud-open')!.addEventListener('click', () => { void openOne(p); });

    const actions = row.querySelector('.cloud-actions') as HTMLElement;
    if (p.owned) {
      // Visibility toggle
      const vis = document.createElement('button');
      const isPublic = p.visibility === 'public';
      vis.className = 'cloud-act' + (isPublic ? ' cloud-act-on' : '');
      vis.textContent = isPublic ? 'Public' : 'Private';
      vis.title = 'Toggle public/private';
      vis.addEventListener('click', async () => {
        try { await setProjectVisibility(p.id, isPublic ? 'private' : 'public'); await render(); }
        catch (err) { alert('Failed: ' + errMsg(err)); }
      });
      actions.appendChild(vis);

      actions.appendChild(actBtn('Share', () => openShareDialog(p.id, p.name)));
      actions.appendChild(actBtn('Category', async () => {
        const c = window.prompt('Category (blank to clear):', p.category ?? '');
        if (c === null) return;
        try { await setProjectCategory(p.id, c.trim() || null); await refresh(); }
        catch (err) { alert('Failed: ' + errMsg(err)); }
      }));
      actions.appendChild(actBtn('Rename', async () => {
        const name = window.prompt('Rename to:', p.name);
        if (name === null) return;
        const next = name.trim() || p.name;
        try {
          const ts = await renameCloudProject(p.id, next);
          if (getCloudDoc().id === p.id) { setCloudDocName(next); setCloudDocUpdatedAt(ts); setProjectName(next); }
          await render();
        } catch (err) { alert('Rename failed: ' + errMsg(err)); }
      }));
      actions.appendChild(actBtn('Delete', async () => {
        if (!window.confirm(`Delete “${p.name}”? This can't be undone.`)) return;
        try {
          await deleteCloudProject(p.id);
          if (getCloudDoc().id === p.id) clearCloudDoc();
          await render();
        } catch (err) { alert('Delete failed: ' + errMsg(err)); }
      }, 'cloud-act-danger'));
    }
    return row;
  };

  void refresh();
}

function actBtn(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `cloud-act ${cls}`.trim();
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
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
          <button class="cloud-act cloud-act-danger share-remove">Remove</button>`;
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
