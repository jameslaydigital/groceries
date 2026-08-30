import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(process.env.DATA_DIR || join(ROOT, 'families'), { recursive: true })

const { getTenantDb, platform, DEFAULT_SUBDOMAIN } = await import('../server.js')
import { applySeed } from './lib/seed-data.mjs'

const subdomain = (process.argv[2] || DEFAULT_SUBDOMAIN).toLowerCase()
const clear = process.argv.includes('--clear')

const family = platform.prepare('SELECT * FROM families WHERE subdomain = ?').get(subdomain)
if (!family) {
  console.error(`Family "${subdomain}" not found. Create it first:`)
  console.error(`  npm run family -- create ${subdomain} "<Family Name>"`)
  process.exit(1)
}

const db = getTenantDb(subdomain)
const count = applySeed(db, clear)

console.log(`✅ seeded ${count} items into "${subdomain}"${clear ? ' (cleared first)' : ''}`)
console.log(`   Visit http://${subdomain}.lvh.me:${process.env.PORT || 8787} to see them`)
