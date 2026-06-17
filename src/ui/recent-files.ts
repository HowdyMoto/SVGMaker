import type { AppState } from '../core/state';
import { openHandle } from './project-file';

/**
 * Recent Files. File System Access handles are structured-cloneable, so we
 * persist them in IndexedDB and reopen them later (re-prompting for permission
 * inside the click gesture).
 */

const DB_NAME = 'svgmaker';
const STORE = 'recent';
const MAX_RECENT = 8;

interface RecentEntry {
  key: string;       // handle.name (good enough for de-duping)
  name: string;
  handle: FileSystemFileHandle;
  ts: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readAll(): Promise<RecentEntry[]> {
  try {
    const db = await openDB();
    const entries = await new Promise<RecentEntry[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as RecentEntry[]);
      req.onerror = () => reject(req.error);
    });
    return entries.sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

export async function rememberRecentFile(handle: FileSystemFileHandle): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    // Timestamp comes from the runtime gesture; Date.now is fine here (UI code).
    store.put({ key: handle.name, name: handle.name, handle, ts: Date.now() } as RecentEntry);
    // Trim to the most-recent MAX_RECENT.
    const all = await readAll();
    for (const old of all.slice(MAX_RECENT)) store.delete(old.key);
    refreshRecentMenu();
  } catch {
    /* IndexedDB unavailable — recent files just won't persist. */
  }
}

let menuState: AppState | null = null;

export function setupRecentFilesMenu(state: AppState): void {
  menuState = state;
  refreshRecentMenu();
}

async function refreshRecentMenu(): Promise<void> {
  const list = document.getElementById('recent-files-list');
  if (!list || !menuState) return;
  const state = menuState;
  const entries = await readAll();

  list.innerHTML = '';
  if (entries.length === 0) {
    const empty = document.createElement('button');
    empty.disabled = true;
    empty.textContent = 'No recent files';
    list.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const btn = document.createElement('button');
    btn.textContent = entry.name;
    btn.title = entry.name;
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.menu-dropdown.open').forEach(d => d.classList.remove('open'));
      try {
        const handle = entry.handle as FileSystemFileHandle & {
          queryPermission?: (d: { mode: string }) => Promise<PermissionState>;
          requestPermission?: (d: { mode: string }) => Promise<PermissionState>;
        };
        if (handle.queryPermission && handle.requestPermission) {
          let perm = await handle.queryPermission({ mode: 'readwrite' });
          if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' });
          if (perm !== 'granted') return;
        }
        await openHandle(state, entry.handle);
      } catch (err) {
        alert('Could not open recent file: ' + (err instanceof Error ? err.message : String(err)));
      }
    });
    list.appendChild(btn);
  }
}
