/**
 * Document tabs across the top. Renders DocumentManager.tabs; click a tab to
 * switch, × to close (with a confirm when dirty), + for a new document.
 */

import type { DocumentManager } from '../core/document-manager';

let docs: DocumentManager | null = null;

export function setupTabBar(dm: DocumentManager): void {
  docs = dm;
  document.getElementById('tab-new')?.addEventListener('click', () => dm.newTab());
  renderTabBar();
}

export function renderTabBar(): void {
  if (!docs) return;
  docs.refreshActive();
  const list = document.getElementById('tab-list');
  if (!list) return;
  list.innerHTML = '';

  const closable = docs.tabs.length > 1;
  for (const t of docs.tabs) {
    const tab = document.createElement('button');
    tab.className = 'doc-tab' + (t.id === docs.activeId ? ' active' : '');
    tab.addEventListener('click', () => docs!.switchTo(t.id));

    if (t.dirty) {
      const dot = document.createElement('span');
      dot.className = 'doc-tab-dirty';
      dot.textContent = '•';
      tab.appendChild(dot);
    }
    const name = document.createElement('span');
    name.className = 'doc-tab-name';
    name.textContent = t.title;
    tab.appendChild(name);

    if (closable) {
      const close = document.createElement('button');
      close.className = 'doc-tab-close';
      close.textContent = '×';
      close.title = 'Close';
      close.addEventListener('click', (e) => { e.stopPropagation(); requestClose(t.id); });
      tab.appendChild(close);
    }
    list.appendChild(tab);
  }
}

function requestClose(id: string): void {
  if (!docs) return;
  const t = docs.tabs.find(x => x.id === id);
  if (t?.dirty && !confirm('Close this document? Unsaved changes will be lost.')) return;
  docs.closeTab(id);
}
