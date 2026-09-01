import { DatabaseSync } from 'node:sqlite'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from './load-env.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
loadEnv({ root: ROOT })

const [cmd, subdomain, ...nameParts] = process.argv.slice(2)

if (cmd !== 'create' || !subdomain || !nameParts.length) {
  console.log(`Usage: npm run family -- create <subdomain> "<Family Name>"`)
  console.log(`  e.g.  npm run family -- create james "The James Family"`)
  process.exit(1)
}

const key = String(subdomain).toLowerCase().replace(/[^a-z0-9-]/g, '-')
if (!key) {
  console.error('Invalid subdomain')
  process.exit(1)
}
const name = nameParts.join(' ')

const platform = new DatabaseSync(join(ROOT, 'platform.db'))
platform.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')

const existing = platform.prepare('SELECT id FROM families WHERE subdomain = ?').get(key)
if (existing) {
  console.error(`Family "${key}" already exists (id ${existing.id})`)
  process.exit(1)
}

const info = platform.prepare('INSERT INTO families (subdomain, name) VALUES (?, ?)').run(key, name)
const base = process.env.BASE_DOMAIN || 'lvh.me'
const port = process.env.BASE_DOMAIN ? '' : `:${process.env.PORT || 8787}`
const scheme = process.env.BASE_DOMAIN ? 'https' : 'http'
console.log(`✅ Created family "${name}" (${key}) — visit ${scheme}://${key}.${base}${port}`)
console.log(`   Tenant database will be created on first visit (families/${key}.db)`)
