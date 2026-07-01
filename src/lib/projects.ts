// ---------------------------------------------------------------------------
// Cloud projects — data access for the `projects` table.
//
// Every call requires a signed-in user; per-user isolation is enforced
// server-side by RLS (see supabase/migrations), so this layer stays simple and
// never filters by user_id itself. A document's `content` is the serialized SVG
// string from serializeDocumentSVG().
// ---------------------------------------------------------------------------

import { supabase } from './supabase';

export interface CloudProjectMeta {
  id: string;
  name: string;
  updated_at: string;
}

export interface CloudProject extends CloudProjectMeta {
  content: string;
}

/** Raised when a write is refused because the row changed elsewhere since it was
 *  loaded (optimistic-concurrency guard). */
export class ProjectConflictError extends Error {
  constructor() {
    super('This project was changed somewhere else since you opened it.');
    this.name = 'ProjectConflictError';
  }
}

function client() {
  if (!supabase) throw new Error('Cloud features are not configured.');
  return supabase;
}

/** A user's projects, most-recently-updated first. Metadata only — no content. */
export async function listCloudProjects(): Promise<CloudProjectMeta[]> {
  const { data, error } = await client()
    .from('projects')
    .select('id, name, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Full document (with content) for one project. */
export async function loadCloudProject(id: string): Promise<CloudProject> {
  const { data, error } = await client()
    .from('projects')
    .select('id, name, updated_at, content')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as CloudProject;
}

/** Create a new cloud project; returns its id/metadata. user_id defaults to auth.uid(). */
export async function createCloudProject(name: string, content: string): Promise<CloudProjectMeta> {
  const { data, error } = await client()
    .from('projects')
    .insert({ name, content })
    .select('id, name, updated_at')
    .single();
  if (error) throw error;
  return data as CloudProjectMeta;
}

/**
 * Overwrite an existing project's content, returning the row's new `updated_at`.
 *
 * When `expectedUpdatedAt` is given, the write only lands if the row still
 * carries that timestamp; otherwise it changed elsewhere and we throw
 * {@link ProjectConflictError} instead of clobbering the newer version. Omit it
 * to force the write (last-write-wins).
 */
export async function updateCloudProject(
  id: string, content: string, expectedUpdatedAt?: string,
): Promise<string> {
  let q = client().from('projects').update({ content }).eq('id', id);
  if (expectedUpdatedAt) q = q.eq('updated_at', expectedUpdatedAt);
  const { data, error } = await q.select('updated_at');
  if (error) throw error;
  if (!data || data.length === 0) {
    // No row matched: a stale timestamp (someone else saved) or the row is gone.
    if (expectedUpdatedAt) throw new ProjectConflictError();
    throw new Error('Project not found.');
  }
  return data[0].updated_at as string;
}

/** Rename a project, returning its new `updated_at` (the trigger bumps it). */
export async function renameCloudProject(id: string, name: string): Promise<string> {
  const { data, error } = await client()
    .from('projects').update({ name }).eq('id', id).select('updated_at');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Project not found.');
  return data[0].updated_at as string;
}

export async function deleteCloudProject(id: string): Promise<void> {
  const { error } = await client().from('projects').delete().eq('id', id);
  if (error) throw error;
}
