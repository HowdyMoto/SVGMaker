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

/** Overwrite an existing project's content (and optionally rename it). */
export async function updateCloudProject(id: string, content: string, name?: string): Promise<void> {
  const patch: { content: string; name?: string } = { content };
  if (name !== undefined) patch.name = name;
  const { error } = await client().from('projects').update(patch).eq('id', id);
  if (error) throw error;
}

export async function renameCloudProject(id: string, name: string): Promise<void> {
  const { error } = await client().from('projects').update({ name }).eq('id', id);
  if (error) throw error;
}

export async function deleteCloudProject(id: string): Promise<void> {
  const { error } = await client().from('projects').delete().eq('id', id);
  if (error) throw error;
}
