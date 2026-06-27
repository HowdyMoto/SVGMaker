// ---------------------------------------------------------------------------
// Supabase client — single shared instance for the whole app.
//
// Config arrives via Vite env vars (see .env.example). When either is missing
// we create NO client and `isAuthConfigured` is false: every account feature
// no-ops and the editor behaves exactly as it did before auth existed. This
// keeps local dev and offline/PWA use working without any secrets.
// ---------------------------------------------------------------------------

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True only when both env vars are present, i.e. accounts are usable. */
export const isAuthConfigured: boolean = Boolean(url && anonKey);

/** The shared client, or null when unconfigured. Always null-check before use. */
export const supabase: SupabaseClient | null = isAuthConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        // Keep the user signed in across reloads and refresh tokens silently.
        persistSession: true,
        autoRefreshToken: true,
        // After an OAuth redirect, parse the session out of the returned URL.
        detectSessionInUrl: true,
      },
    })
  : null;

if (import.meta.env.DEV && !isAuthConfigured) {
  console.info('[supabase] not configured — account features disabled. Add VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY to .env.local to enable.');
}
