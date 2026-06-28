// ---------------------------------------------------------------------------
// Auth operations — a thin, framework-free wrapper over Supabase Auth.
//
// Every function tolerates the unconfigured case (supabase === null) so callers
// never need their own guards. UI lives in ui/account.ts; this module is pure
// data/session plumbing.
// ---------------------------------------------------------------------------

import { supabase } from './supabase';
import type { Session, User } from '@supabase/supabase-js';

/** OAuth providers we intend to enable in the Supabase dashboard (Phase 1). */
export type OAuthProvider = 'google' | 'discord';

/**
 * Where the provider sends the browser back to after login. We return to the
 * current page (sans hash/query so a stale OAuth fragment can't linger). This
 * exact URL must be added to Supabase → Authentication → URL Configuration →
 * Redirect URLs for both the prod domain and any preview/localhost origins.
 */
function redirectTo(): string {
  return window.location.origin + window.location.pathname;
}

/** Begin an OAuth sign-in. Navigates away to the provider, then back. */
export async function signInWith(provider: OAuthProvider): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: redirectTo() },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

/** Current session, or null when signed out / unconfigured. */
export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Subscribe to auth state. Fires once with the initial user, then on every
 * sign-in/out/token-refresh. Returns an unsubscribe function. When unconfigured
 * it invokes the callback once with null and is otherwise inert.
 */
export function onAuthChange(cb: (user: User | null) => void): () => void {
  if (!supabase) {
    cb(null);
    return () => { /* nothing to unsubscribe */ };
  }
  // Emit the current value immediately so callers don't render a blank state
  // while waiting for the first event.
  void supabase.auth.getSession().then(({ data }) => cb(data.session?.user ?? null));
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}

/** Best-effort display name for a user (full name → email → 'Account'). */
export function displayName(user: User): string {
  const meta = user.user_metadata as { full_name?: string; name?: string } | undefined;
  return meta?.full_name || meta?.name || user.email || 'Account';
}
