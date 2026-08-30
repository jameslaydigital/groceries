import { svelte } from '@sveltejs/vite-plugin-svelte'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vite'

// Bump the service worker cache version on every build so browsers always
// pick up a fresh set of assets instead of serving stale cached ones.
function swVersion() {
  return {
    name: 'sw-version',
    apply: 'build',
    closeBundle() {
      const file = join('dist', 'sw.js')
      let code
      try {
        code = readFileSync(file, 'utf8')
      } catch {
        return
      }
      const version = Date.now().toString(36)
      writeFileSync(file, code.replace('__SW_VERSION__', version))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), swVersion()],
  server: {
    proxy: {
      '/rpc': 'http://localhost:8787',
      '/events': 'http://localhost:8787',
    },
  },
})
