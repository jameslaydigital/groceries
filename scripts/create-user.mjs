import { DatabaseSync } from 'node:sqlite'
import { randomBytes, scryptSync } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from './load-env.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
loadEnv({ root: ROOT })

const usage = `Usage: npm run user -- create <family> <email> <password> [--name "<Display Name>"] [--member]
  e.g.  npm run user -- create james me@example.com hunter2 --name "James"
Roles default to admin; pass --member for a regular member.`

const args = process.argv.slice(2)
if (args[0] !== 'create') {
  console.log(usage)
  process.exit(1)
}
const [family, email, password] = [args[1], args[2], args[3]]
let name = ''
let role = 'admin'
for (let i = 4; i < args.length; i++) {
  if (args[i] === '--name') name = args[++i] ?? ''
  else if (args[i] === '--member') role = 'member'
}
if (!family || !email || !password) {
  console.log(usage)
  process.exit(1)
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters')
  process.exit(1)
}

function hashPassword(pw) {
  const salt = randomBytes(16)
  const hash = scryptSync(pw, salt, 64)
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`
}

const platform = new DatabaseSync(join(ROOT, 'platform.db'))
platform.exec('PRAGMA foreign_keys = ON;')

const fam = platform.prepare('SELECT id FROM families WHERE subdomain = ?').get(family)
if (!fam) {
  console.error(`Family "${family}" not found. Create it first:`)
  console.error(`  npm run family -- create ${family} "<Family Name>"`)
  process.exit(1)
}

let user = platform.prepare('SELECT id FROM users WHERE email = ?').get(email)
if (!user) {
  const info = platform
    .prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)')
    .run(email, hashPassword(password), name || null)
  user = { id: info.lastInsertRowid }
} else {
  console.log(`ℹ user ${email} already exists — resetting password${name ? ' and name' : ''}`)
  platform.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id)
  if (name) platform.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, user.id)
}

const membership = platform.prepare('SELECT * FROM memberships WHERE user_id = ? AND family_id = ?').get(user.id, fam.id)
if (membership) {
  platform.prepare('UPDATE memberships SET role = ? WHERE user_id = ? AND family_id = ?').run(role, user.id, fam.id)
} else {
  platform.prepare('INSERT INTO memberships (user_id, family_id, role) VALUES (?, ?, ?)').run(user.id, fam.id, role)
}

console.log(`✅ ${email} is now ${role} of "${family}"`)
console.log(`   Log in at http://${family}.lvh.me:${process.env.PORT || 8787}`)
