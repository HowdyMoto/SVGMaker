// ---------------------------------------------------------------------------
// Cloud projects — data access for the `projects` table.
//
// Every call requires a signed-in user; per-user isolation is enforced
// server-side by RLS (see supabase/migrations), so this layer stays simple and
// never filters by user_id itself. A document's `content` is the serialized SVG
// string from serializeDocumentSVG().
// ---------------------------------------------------------------------------

import { supabase } from './supabase';

export type ProjectVisibility = 'private' | 'public';
export type ShareRole = 'viewer' | 'editor';

export interface CloudProjectMeta {
  id: string;
  name: string;
  updated_at: string;
  visibility?: ProjectVisibility;
  category?: string | null;
  /** For projects shared WITH the current user: their role; absent for own boards. */
  role?: ShareRole;
  /** For shared/public boards: not the current user's own. */
  owned?: boolean;
}

export interface CloudProject extends CloudProjectMeta {
  content: string;
}

export interface ProjectShare {
  grantee_id: string;
  grantee_email: string | null;
  role: ShareRole;
}

const META_COLS = 'id, name, updated_at, visibility, category';

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

async function currentUserId(): Promise<string> {
  const { data } = await client().auth.getUser();
  const id = data.user?.id;
  if (!id) throw new Error('Not signed in.');
  return id;
}

/** The current user's OWN projects, most-recently-updated first (metadata only). */
export async function listMyProjects(): Promise<CloudProjectMeta[]> {
  const uid = await currentUserId();
  const { data, error } = await client()
    .from('projects')
    .select(META_COLS)
    .eq('user_id', uid)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as CloudProjectMeta[]).map(p => ({ ...p, owned: true }));
}

/** Projects shared WITH the current user (with their granted role). */
export async function listSharedWithMe(): Promise<CloudProjectMeta[]> {
  const uid = await currentUserId();
  const { data, error } = await client()
    .from('project_shares')
    .select('role, projects(id, name, updated_at, visibility, category)')
    .eq('grantee_id', uid);
  if (error) throw error;
  const out: CloudProjectMeta[] = [];
  for (const row of (data ?? []) as unknown as Array<{ role: ShareRole; projects: CloudProjectMeta | CloudProjectMeta[] | null }>) {
    const p = Array.isArray(row.projects) ? row.projects[0] : row.projects;
    if (p) out.push({ ...p, role: row.role, owned: false });
  }
  return out.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

/** Public boards (the gallery), most-recent first. Capped. */
export async function listPublicProjects(limit = 60): Promise<CloudProjectMeta[]> {
  const uid = await currentUserId().catch(() => null);
  const { data, error } = await client()
    .from('projects')
    .select(META_COLS + ', user_id')
    .eq('visibility', 'public')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as unknown as Array<CloudProjectMeta & { user_id?: string }>).map(p => ({
    ...p, owned: p.user_id === uid,
  }));
}

/** Back-compat alias — the original single list (now: the user's own boards). */
export const listCloudProjects = listMyProjects;

// ---- Visibility & category ----

export async function setProjectVisibility(id: string, visibility: ProjectVisibility): Promise<void> {
  const { error } = await client().from('projects').update({ visibility }).eq('id', id);
  if (error) throw error;
}

export async function setProjectCategory(id: string, category: string | null): Promise<void> {
  const { error } = await client().from('projects').update({ category: category || null }).eq('id', id);
  if (error) throw error;
}

/** Distinct non-empty categories across the user's own boards (for filter chips). */
export async function listCategories(): Promise<string[]> {
  const uid = await currentUserId();
  const { data, error } = await client()
    .from('projects').select('category').eq('user_id', uid).not('category', 'is', null);
  if (error) throw error;
  return [...new Set((data ?? []).map(r => (r as { category: string }).category).filter(Boolean))].sort();
}

// ---- Sharing ----

/** Current collaborators on a project (owner-only via RLS). */
export async function listShares(projectId: string): Promise<ProjectShare[]> {
  const { data, error } = await client()
    .from('project_shares')
    .select('grantee_id, grantee_email, role')
    .eq('project_id', projectId);
  if (error) throw error;
  return (data ?? []) as ProjectShare[];
}

/**
 * Grant a BuzzQuill user (by email) viewer/editor access to a project. Resolves
 * the email to a user id via the find_user_by_email RPC. Throws a friendly error
 * if there's no account for that email.
 */
export async function shareProject(projectId: string, email: string, role: ShareRole): Promise<void> {
  const trimmed = email.trim();
  const { data: uid, error: rpcErr } = await client().rpc('find_user_by_email', { email_input: trimmed });
  if (rpcErr) throw rpcErr;
  if (!uid) throw new Error(`No BuzzQuill account found for ${trimmed}.`);
  const { error } = await client()
    .from('project_shares')
    .upsert({ project_id: projectId, grantee_id: uid as string, grantee_email: trimmed, role },
      { onConflict: 'project_id,grantee_id' });
  if (error) throw error;
}

export async function unshareProject(projectId: string, granteeId: string): Promise<void> {
  const { error } = await client()
    .from('project_shares').delete().eq('project_id', projectId).eq('grantee_id', granteeId);
  if (error) throw error;
}

/** Full document (with content) for one project. */
export async function loadCloudProject(id: string): Promise<CloudProject> {
  const { data, error } = await client()
    .from('projects')
    .select(META_COLS + ', content')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as unknown as CloudProject;
}

/** Create a new cloud project; returns its id/metadata. user_id defaults to auth.uid(). */
export async function createCloudProject(name: string, content: string, category?: string | null): Promise<CloudProjectMeta> {
  const { data, error } = await client()
    .from('projects')
    .insert({ name, content, category: category || null })
    .select(META_COLS)
    .single();
  if (error) throw error;
  return data as unknown as CloudProjectMeta;
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
