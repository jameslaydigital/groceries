import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Tiny dotenv-style loader (no deps): reads `$root/.env` and sets any vars
 * that aren't already in the environment. Real env vars / systemd
 * `Environment=` lines always win over the file.
 *
 * Returns true if a .env file was loaded.
 */
export function loadEnv({ root } = {}) {
  const base = root || join(dirname(fileURLToPath(import.meta.url)), '..')
  let text = ''
  try {
    text = readFileSync(join(base, '.env'), 'utf8')
  } catch {
    return false
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(m[1] in process.env)) process.env[m[1]] = value
  }
  return true
}
