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
import { getCloudDoc, setCloudDoc, clearCloudDoc } from '../lib/cloud-doc';
import {
  listCloudProjects, loadCloudProject, createCloudProject,
  updateCloudProject, renameCloudProject, deleteCloudProject,
  type CloudProjectMeta,
} from '../lib/projects';

let appState: AppState | null = null;
let statusEl: HTMLElement | null = null;
let statusClearTimer: number | null = null;

const AUTOSAVE_IDLE_MS = 2500; // quiet period before autosaving a cloud doc
let autosaveTimer: number | null = null;
let autosaving = false;

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

type Status = 'saving' | 'saved' | 'error' | 'idle';
function setStatus(s: Status): void {
  if (!statusEl) return;
  if (statusClearTimer) { clearTimeout(statusClearTimer); statusClearTimer = null; }
  const label = s === 'saving' ? 'Saving…' : s === 'saved' ? 'All changes saved' : s === 'error' ? 'Save failed' : '';
  statusEl.textContent = label;
  statusEl.className = `cloud-status ${s === 'idle' ? '' : 'show ' + s}`;
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
  const { id } = getCloudDoc();
  try {
    setStatus('saving');
    if (id) {
      await updateCloudProject(id, content);
    } else {
      const current = document.getElementById('project-name')?.textContent?.replace(/\.svg$/i, '') || 'Untitled';
      const name = window.prompt('Save to cloud as:', current);
      if (name === null) { setStatus('idle'); return; } // cancelled
      const meta = await createCloudProject(name.trim() || 'Untitled', content);
      setCloudDoc(meta.id, meta.name);
      setProjectName(meta.name);
    }
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
  if (!getCloudDoc().id || !isSignedIn() || !state.dirty) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => { void doAutosave(); }, AUTOSAVE_IDLE_MS);
}

async function doAutosave(): Promise<void> {
  const state = appState;
  if (!state) return;
  const { id } = getCloudDoc();
  if (!id || autosaving || !state.dirty || !isSignedIn()) return;
  autosaving = true;
  try {
    setStatus('saving');
    await updateCloudProject(id, serializeDocumentSVG(state));
    state.markClean();
    setStatus('saved');
  } catch (err) {
    setStatus('error');
    console.warn('Cloud autosave failed:', err);
  } finally {
    autosaving = false;
  }
}

/** The "Open from Cloud" file-browser modal: list, open, rename, delete. */
export async function openFromCloud(state: AppState): Promise<void> {
  if (!requireSignIn()) return;
  const modal = openModal({ id: 'cloud-overlay', ariaLabel: 'Open from Cloud', dialogClass: 'cloud-dialog' });
  if (!modal) return; // singleton already open

  modal.dialog.insertAdjacentHTML('beforeend', `
    <h1 class="cloud-title">Your Cloud Files</h1>
    <div class="cloud-list" aria-live="polite">Loading…</div>
  `);
  const listEl = modal.dialog.querySelector('.cloud-list') as HTMLElement;

  const openOne = async (p: CloudProjectMeta): Promise<void> => {
    if (!confirmDiscard(state)) return;
    try {
      const full = await loadCloudProject(p.id);
      loadDocumentSVG(state, full.content); // handles render + markClean
      setCloudDoc(full.id, full.name);
      setProjectName(full.name);
      modal.close();
    } catch (err) {
      alert('Open failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const render = async (): Promise<void> => {
    try {
      const projects = await listCloudProjects();
      if (projects.length === 0) {
        listEl.innerHTML = '<div class="cloud-empty">No cloud files yet. Use “Save to Cloud” to add one.</div>';
        return;
      }
      listEl.innerHTML = '';
      for (const p of projects) listEl.appendChild(rowFor(p));
    } catch (err) {
      listEl.innerHTML = `<div class="cloud-empty">Failed to load: ${escapeHtml(err instanceof Error ? err.message : String(err))}</div>`;
    }
  };

  const rowFor = (p: CloudProjectMeta): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'cloud-row';
    row.innerHTML = `
      <button class="cloud-open" title="Open this file">
        <span class="cloud-name"></span>
        <span class="cloud-when"></span>
      </button>
      <button class="cloud-act cloud-rename" title="Rename">Rename</button>
      <button class="cloud-act cloud-delete" title="Delete">Delete</button>
    `;
    (row.querySelector('.cloud-name') as HTMLElement).textContent = p.name;
    (row.querySelector('.cloud-when') as HTMLElement).textContent = new Date(p.updated_at).toLocaleString();

    row.querySelector('.cloud-open')!.addEventListener('click', () => { void openOne(p); });

    row.querySelector('.cloud-rename')!.addEventListener('click', async () => {
      const name = window.prompt('Rename to:', p.name);
      if (name === null) return;
      const next = name.trim() || p.name;
      try {
        await renameCloudProject(p.id, next);
        if (getCloudDoc().id === p.id) { setCloudDoc(p.id, next); setProjectName(next); }
        await render();
      } catch (err) {
        alert('Rename failed: ' + (err instanceof Error ? err.message : String(err)));
      }
    });

    row.querySelector('.cloud-delete')!.addEventListener('click', async () => {
      if (!window.confirm(`Delete “${p.name}”? This can't be undone.`)) return;
      try {
        await deleteCloudProject(p.id);
        if (getCloudDoc().id === p.id) clearCloudDoc(); // open doc is now untethered
        await render();
      } catch (err) {
        alert('Delete failed: ' + (err instanceof Error ? err.message : String(err)));
      }
    });

    return row;
  };

  void render();
}
