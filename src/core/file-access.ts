/**
 * Thin wrapper around the File System Access API (Chrome/Edge) with a
 * graceful anchor-download fallback for browsers that don't support it
 * (Firefox/Safari). When supported, callers can keep the returned
 * FileSystemFileHandle and write back to the same file with no re-prompt.
 */

export interface FilePickerType {
  description: string;
  accept: Record<string, string[]>;
}

/** True when the browser can open/save files in place (secure context required). */
export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

/** Prompt the user to choose a file to open. Returns null if unsupported or cancelled. */
export async function openFilePicker(types: FilePickerType[]): Promise<FileSystemFileHandle | null> {
  if (!supportsFileSystemAccess()) return null;
  try {
    const [handle] = await window.showOpenFilePicker({ types, multiple: false });
    return handle ?? null;
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return null;
    throw err;
  }
}

/** Prompt the user for a save location. Returns null if unsupported or cancelled. */
export async function saveFilePicker(
  suggestedName: string,
  types: FilePickerType[],
): Promise<FileSystemFileHandle | null> {
  if (!supportsFileSystemAccess()) return null;
  try {
    return await window.showSaveFilePicker({ suggestedName, types });
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return null;
    throw err;
  }
}

/** Write text or a blob to a handle obtained from a picker. */
export async function writeHandle(handle: FileSystemFileHandle, contents: string | Blob): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close();
}

/** Read a handle's current contents as text. */
export async function readHandle(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  return await file.text();
}

/** Legacy fallback: trigger a browser download (drops into the Downloads folder). */
export function downloadFile(filename: string, contents: string | Blob, mime: string): void {
  const blob = contents instanceof Blob ? contents : new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
