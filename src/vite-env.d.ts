/// <reference types="vite/client" />

/** Package version, injected at build time via Vite `define` (see vite.config.ts). */
declare const __APP_VERSION__: string;

/** Build identity (short commit SHA + ISO date), injected by vite.config.ts. */
declare const __BUILD_SHA__: string;
declare const __BUILD_DATE__: string;

/**
 * Supabase config, supplied at build time via Vite env vars (see .env.example).
 * Both are optional: when absent the app runs exactly as before with all
 * account features disabled (see lib/supabase.ts `isAuthConfigured`).
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
