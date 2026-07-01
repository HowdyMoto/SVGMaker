// ---------------------------------------------------------------------------
// Current cloud document — tracks which `projects` row (if any) the in-editor
// document maps to, so Save and autosave target the right row.
//
// Also tracks the row's server `updatedAt` as of our last load/save. That is the
// baseline for optimistic-concurrency conflict detection: a write only lands if
// the row still carries this timestamp, so a save from another device can't be
// silently clobbered (see lib/projects.ts + ui/cloud.ts).
//
// Deliberately standalone (no imports) to stay out of the import cycle between
// project-file.ts (local save/load) and the cloud UI: project-file.ts clears
// this on New/Open-local, the cloud UI sets it on cloud Save/Open.
// ---------------------------------------------------------------------------

let id: string | null = null;
let name: string | null = null;
let updatedAt: string | null = null;

/** The open cloud doc, or { id: null } when the current document isn't a cloud doc. */
export function getCloudDoc(): { id: string | null; name: string | null; updatedAt: string | null } {
  return { id, name, updatedAt };
}

export function setCloudDoc(docId: string, docName: string, docUpdatedAt: string): void {
  id = docId;
  name = docName;
  updatedAt = docUpdatedAt;
}

/** Refresh the tracked server timestamp after one of OUR OWN successful writes,
 *  so the next save's conflict check compares against the right baseline. */
export function setCloudDocUpdatedAt(ts: string): void {
  updatedAt = ts;
}

/** Update just the tracked name (after a rename), keeping id/updatedAt. */
export function setCloudDocName(newName: string): void {
  name = newName;
}

export function clearCloudDoc(): void {
  id = null;
  name = null;
  updatedAt = null;
}
