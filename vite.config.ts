import { defineConfig } from 'vite'
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

export default defineConfig({
  base: './',
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
})
