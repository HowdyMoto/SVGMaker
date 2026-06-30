import { defineConfig, type Plugin } from 'vite'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

function tryGit(cmd: string): string {
  try { return execSync(cmd).toString().trim() } catch { return '' }
}
// Build identity shown in the About dialog. Cloudflare Pages injects
// CF_PAGES_COMMIT_SHA in CI; fall back to local git for dev builds. This updates
// on every push to master with no version-bump commits required.
const buildSha = (process.env.CF_PAGES_COMMIT_SHA || tryGit('git rev-parse --short HEAD')).slice(0, 7) || 'dev'
const buildDate = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

/**
 * Build the Content-Security-Policy and inject it into index.html (replacing the
 * `<!-- INJECT_CSP -->` marker). The policy is the runtime backstop behind the
 * import sanitizer (core/svg-sanitize.ts): no external/inline scripts, and the
 * network surface narrowed so a crafted SVG can't beacon out.
 *
 * Production drops the things only the dev server needs — Vite HMR's `ws:`/`wss:`
 * wildcards — and the `blob:`/`data:` connect-src entries nothing actually
 * fetches (fonts/images load from same-origin bundled assets; downloads use
 * <a href blob:>, which isn't connect-src). The shipped policy is therefore just
 * `self` + Supabase. The same policy is set as a real HTTP header in
 * public/_headers, which additionally carries frame-ancestors / nosniff.
 */
function buildCsp(isDev: boolean): string {
  // Vite HMR needs a websocket to the dev server (and an http connect for the
  // ping); neither exists in production.
  const connectExtra = isDev ? "ws: wss: http://localhost:* " : ''
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // editor sets inline styles pervasively
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${connectExtra}https://*.supabase.co wss://*.supabase.co`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join('; ')
}

function cspPlugin(isDev: boolean): Plugin {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${buildCsp(isDev)}" />`
  return {
    name: 'inject-csp',
    transformIndexHtml(html) {
      return html.replace('<!-- INJECT_CSP -->', tag)
    },
  }
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [cspPlugin(mode === 'development')],
  // Surface the package version to the app (shown in the About dialog).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(buildSha),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  server: {
    port: 5180,
    strictPort: true,
  },
  preview: {
    port: 5180,
    strictPort: true,
  },
}))
