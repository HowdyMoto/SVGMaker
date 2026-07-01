// ---------------------------------------------------------------------------
// Current cloud document — tracks which `projects` row (if any) the in-editor
// document maps to, so Save and autosave target the right row.
//
// Deliberately standalone (no imports) to stay out of the import cycle between
// project-file.ts (local save/load) and the cloud UI: project-file.ts clears
// this on New/Open-local, the cloud UI sets it on cloud Save/Open.
// ---------------------------------------------------------------------------

let id: string | null = null;
let name: string | null = null;

/** The open cloud doc, or { id: null } when the current document isn't a cloud doc. */
export function getCloudDoc(): { id: string | null; name: string | null } {
  return { id, name };
}

export function setCloudDoc(docId: string, docName: string): void {
  id = docId;
  name = docName;
}

export function clearCloudDoc(): void {
  id = null;
  name = null;
}
