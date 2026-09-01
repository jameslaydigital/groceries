import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from './load-env.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
loadEnv({ root: ROOT })
mkdirSync(process.env.DATA_DIR || join(ROOT, 'families'), { recursive: true })

const { platform, getTenantDb, hashPassword, DEFAULT_SUBDOMAIN } = await import('../server.js')
import { applySeed } from './lib/seed-data.mjs'

// One-shot dev provisioning: family + known admin login + sample data.
// Safe to run any time — it's idempotent.
const subdomain = (process.argv[2] || DEFAULT_SUBDOMAIN).toLowerCase()
const email = process.argv[3] || 'dev@example.com'
const password = process.argv[4] || 'devpassword'

// 1. Ensure the family exists
let family = platform.prepare('SELECT * FROM families WHERE subdomain = ?').get(subdomain)
if (!family) {
  const name = subdomain.charAt(0).toUpperCase() + subdomain.slice(1)
  platform.prepare('INSERT INTO families (subdomain, name) VALUES (?, ?)').run(subdomain, name)
  family = platform.prepare('SELECT * FROM families WHERE subdomain = ?').get(subdomain)
  console.log(`✓ family "${subdomain}" created`)
} else {
  console.log(`ℹ family "${subdomain}" already exists`)
}

// 2. Ensure the dev user exists as admin
let user = platform.prepare('SELECT * FROM users WHERE email = ?').get(email)
if (!user) {
  const info = platform
    .prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)')
    .run(email, hashPassword(password), 'Dev')
  user = { id: info.lastInsertRowid }
  console.log(`✓ user ${email} created`)
} else {
  platform.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id)
  console.log(`ℹ user ${email} exists — password reset to the one you provided`)
}
const membership = platform.prepare('SELECT * FROM memberships WHERE user_id = ? AND family_id = ?').get(user.id, family.id)
if (membership) {
  platform.prepare('UPDATE memberships SET role = ? WHERE user_id = ? AND family_id = ?').run('admin', user.id, family.id)
} else {
  platform.prepare('INSERT INTO memberships (user_id, family_id, role) VALUES (?, ?, ?)').run(user.id, family.id, 'admin')
}

// 3. Seed sample data if the family is empty
const db = getTenantDb(subdomain)
const { n } = db.prepare('SELECT COUNT(*) AS n FROM items').get()
if (n === 0) {
  const count = applySeed(db, false)
  console.log(`✓ seeded ${count} items`)
} else {
  console.log(`ℹ family already has ${n} items — skipping seed (use "npm run seed -- ${subdomain} --clear" to reseed)`)
}

console.log(`✅ dev login ready → http://${subdomain}.lvh.me:${process.env.PORT || 8787}`)
console.log(`   ${email} / ${password}`)
