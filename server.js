import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const DIST = join(ROOT, 'dist')
const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'families')
const PLATFORM_DB = process.env.PLATFORM_DB || join(ROOT, 'platform.db')
const PORT = process.env.PORT || 8787
const DEFAULT_SUBDOMAIN = process.env.DEFAULT_SUBDOMAIN || 'home'

mkdirSync(DATA_DIR, { recursive: true })

/* ------------------------------------------------------------------ */
/* Platform database (users, families, memberships, sessions)          */
/* ------------------------------------------------------------------ */

const PLATFORM_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS families (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     subdomain  TEXT NOT NULL UNIQUE,
     name       TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE IF NOT EXISTS users (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     email         TEXT NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     display_name  TEXT,
     created_at    TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE IF NOT EXISTS memberships (
     user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
     role      TEXT NOT NULL DEFAULT 'member',
     PRIMARY KEY (user_id, family_id)
   );
   CREATE TABLE IF NOT EXISTS sessions (
     token      TEXT PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     expires_at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);`,
  `CREATE TABLE IF NOT EXISTS invites (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     family_id  INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
     email      TEXT NOT NULL,
     role       TEXT NOT NULL DEFAULT 'member',
     created_by INTEGER REFERENCES users(id),
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (family_id, email)
   );`,
]

function migratePlatform(db) {
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  const { user_version } = db.prepare('PRAGMA user_version').get()
  for (let v = user_version + 1; v <= PLATFORM_MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(PLATFORM_MIGRATIONS[v - 1])
      db.exec(`PRAGMA user_version = ${v}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

const platform = new DatabaseSync(PLATFORM_DB)
migratePlatform(platform)

/* Adopt a legacy single-tenant groceries.db into the default family if
   that family has no database yet — keeps existing lists around. */
function adoptLegacyDb() {
  if (process.env.SKIP_LEGACY_ADOPTION) return
  const legacy = join(ROOT, 'groceries.db')
  const target = join(DATA_DIR, `${DEFAULT_SUBDOMAIN}.db`)
  if (existsSync(legacy) && !existsSync(target)) {
    copyFileSync(legacy, target)
    console.log(`📦 adopted legacy database → ${target}`)
  }
}

/* Seed a default family so localhost just works out of the box. */
function seedDefaultFamily() {
  const row = platform.prepare('SELECT id FROM families WHERE subdomain = ?').get(DEFAULT_SUBDOMAIN)
  if (!row) {
    platform
      .prepare('INSERT INTO families (subdomain, name) VALUES (?, ?)')
      .run(DEFAULT_SUBDOMAIN, DEFAULT_SUBDOMAIN.charAt(0).toUpperCase() + DEFAULT_SUBDOMAIN.slice(1))
    console.log(`🏠 seeded default family "${DEFAULT_SUBDOMAIN}"`)
  }
}

adoptLegacyDb()
seedDefaultFamily()

/* ------------------------------------------------------------------ */
/* Tenant databases (one sqlite file per family)                        */
/* ------------------------------------------------------------------ */

const TENANT_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS categories (
     id         INTEGER PRIMARY KEY,
     name       TEXT NOT NULL UNIQUE,
     icon       TEXT NOT NULL DEFAULT '🛒',
     sort_order INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE IF NOT EXISTS items (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     name       TEXT NOT NULL,
     quantity   TEXT NOT NULL DEFAULT '1',
     category   TEXT NOT NULL DEFAULT 'Other' REFERENCES categories(name),
     checked    INTEGER NOT NULL DEFAULT 0,
     position   INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
   CREATE INDEX IF NOT EXISTS idx_items_checked ON items(checked);`,
  `CREATE TABLE IF NOT EXISTS tags (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     name       TEXT NOT NULL UNIQUE,
     icon       TEXT NOT NULL DEFAULT '🏷️',
     sort_order INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE IF NOT EXISTS item_tags (
     item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
     tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
     PRIMARY KEY (item_id, tag_id)
   );
   CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id);`,
]

const DEFAULT_CATEGORIES = [
  ['Produce', '🥬', 1],
  ['Dairy', '🥛', 2],
  ['Bakery', '🥐', 3],
  ['Meat & Seafood', '🥩', 4],
  ['Frozen', '🧊', 5],
  ['Pantry', '🥫', 6],
  ['Snacks', '🍿', 7],
  ['Beverages', '🥤', 8],
  ['Household', '🧼', 9],
  ['Other', '🛒', 99],
]

const DEFAULT_TAGS = [
  ['Costco', '🛒', 1],
  ["Trader Joe's", '🥑', 2],
  ["Smith's", '🏬', 3],
]

function migrateTenant(db) {
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  const { user_version } = db.prepare('PRAGMA user_version').get()
  for (let v = user_version + 1; v <= TENANT_MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(TENANT_MIGRATIONS[v - 1])
      db.exec(`PRAGMA user_version = ${v}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM categories').get()
  if (n === 0) {
    const ins = db.prepare('INSERT INTO categories (name, icon, sort_order) VALUES (?, ?, ?)')
    for (const c of DEFAULT_CATEGORIES) ins.run(...c)
  }

  const { t } = db.prepare('SELECT COUNT(*) AS t FROM tags').get()
  if (t === 0) {
    const ins = db.prepare('INSERT INTO tags (name, icon, sort_order) VALUES (?, ?, ?)')
    for (const tag of DEFAULT_TAGS) ins.run(...tag)
  }
}

const tenantCache = new Map()

// Subdomains become directory-relative filenames, so we only ever accept a
// conservative whitelist. Rejects `..`, `/`, dots, uppercase, etc.
const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

function getTenantDb(subdomain) {
  if (!SUBDOMAIN_RE.test(subdomain)) {
    throw new TenantError(`Invalid tenant key "${subdomain}"`, 'NO_FAMILY')
  }
  let db = tenantCache.get(subdomain)
  if (!db) {
    db = new DatabaseSync(join(DATA_DIR, `${subdomain}.db`))
    migrateTenant(db)
    tenantCache.set(subdomain, db)
  }
  return db
}

/* ------------------------------------------------------------------ */
/* Tenant resolution from the Host header                               */
/* ------------------------------------------------------------------ */

function tenantKeyFromHost(host) {
  let h = String(host ?? '').trim().toLowerCase()
  if (!h) return null
  // bracketed IPv6 literal → treat as the default tenant
  if (/^\[[^\]]+\](?::\d+)?$/.test(h)) return DEFAULT_SUBDOMAIN
  h = h.split(':')[0]
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return DEFAULT_SUBDOMAIN
  for (const bare of ['lvh.me']) {
    if (h === bare) return DEFAULT_SUBDOMAIN
    if (h.endsWith('.' + bare)) {
      const key = h.slice(0, -(bare.length + 1)).replace(/[^a-z0-9-]/g, '-')
      if (key) return key
    }
  }
  return h.replace(/[^a-z0-9-]/g, '-') || null
}

class TenantError extends Error {
  constructor(message, code = 'NO_FAMILY') {
    super(message)
    this.code = code
  }
}

/* ------------------------------------------------------------------ */
/* Authentication                                                       */
/* ------------------------------------------------------------------ */

const SESSION_COOKIE = 'groceries.session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const PASSWORD_MIN = 8

function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false
  const [alg, saltHex, hashHex] = stored.split(':')
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, salt, expected.length)
  return timingSafeEqual(actual, expected)
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

function newSessionToken() {
  return randomBytes(32).toString('base64url')
}

function parseCookies(header = '') {
  const out = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const name = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (name) out[name] = decodeURIComponent(value)
  }
  return out
}

function cookieDomainFor(host) {
  const h = String(host ?? '').split(':')[0].toLowerCase()
  if (process.env.COOKIE_DOMAIN) return process.env.COOKIE_DOMAIN
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.startsWith('[')) return ''
  if (h.endsWith('.lvh.me')) return '.lvh.me'
  return ''
}

function isSecureHost(host) {
  return process.env.COOKIE_SECURE === '1'
}

function buildSessionCookie(token, host) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/']
  const domain = cookieDomainFor(host)
  if (domain) parts.push(`Domain=${domain}`)
  if (isSecureHost(host)) parts.push('Secure')
  parts.push(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`)
  return parts.join('; ')
}

function buildExpiredCookie(host) {
  const parts = [`${SESSION_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/']
  const domain = cookieDomainFor(host)
  if (domain) parts.push(`Domain=${domain}`)
  if (isSecureHost(host)) parts.push('Secure')
  parts.push('Max-Age=0', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  return parts.join('; ')
}

const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase()

function memberFamiliesForUser(userId) {
  return platform
    .prepare(
      `SELECT f.id, f.subdomain, f.name, m.role
       FROM memberships m JOIN families f ON f.id = m.family_id
       WHERE m.user_id = ?
       ORDER BY f.name`
    )
    .all(userId)
}

function loadUserById(id) {
  return platform.prepare('SELECT id, email, display_name FROM users WHERE id = ?').get(id)
}

function issueSession(userId, ctx) {
  const token = newSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  platform
    .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, expiresAt)
  ctx.cookies.push(buildSessionCookie(token, ctx.host))
  return token
}

function destroySession(ctx) {
  ctx.cookies.push(buildExpiredCookie(ctx.host))
}

function authResult(user, subdomain) {
  const families = memberFamiliesForUser(user.id)
  const membership = families.find((f) => f.subdomain === subdomain)
  return {
    family: platform.prepare('SELECT * FROM families WHERE subdomain = ?').get(subdomain),
    user: { id: user.id, email: user.email, display_name: user.display_name },
    role: membership?.role ?? null,
    families,
  }
}

/* ------------------------------------------------------------------ */
/* Tenant resolution + request context                                  */
/* ------------------------------------------------------------------ */

function buildCtx(req) {
  const host = req?.headers?.host
  const subdomain = tenantKeyFromHost(host)
  if (!subdomain) throw new TenantError('Could not determine family from host', 'NO_FAMILY')
  const family = platform.prepare('SELECT * FROM families WHERE subdomain = ?').get(subdomain)
  if (!family) {
    throw new TenantError(
      `No family found for "${subdomain}". Create one with: npm run family create ${subdomain} "<Name>"`,
      'NO_FAMILY'
    )
  }
  const db = getTenantDb(subdomain)

  // Resolve the session from the cookie, if any.
  const token = parseCookies(req?.headers?.cookie)[SESSION_COOKIE]
  let user = null
  let role = null
  let families = []
  let memberships = []
  if (token) {
    const session = platform.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(sha256(token))
    if (session && new Date(session.expires_at).getTime() > Date.now()) {
      user = loadUserById(session.user_id)
      memberships = memberFamiliesForUser(user.id)
      const membership = memberships.find((m) => m.subdomain === subdomain)
      role = membership?.role ?? null
    }
  }

  const { n: memberCount } = platform
    .prepare('SELECT COUNT(*) AS n FROM memberships WHERE family_id = ?')
    .get(family.id)

  return { db, family, user, role, families: memberships, bootstrap: memberCount === 0 }
}

/* ------------------------------------------------------------------ */
/* RPC methods                                                          */
/* ------------------------------------------------------------------ */

const listCategories = (db) =>
  db.prepare(`
    SELECT c.name, c.icon, c.sort_order, COUNT(i.id) AS item_count
    FROM categories c
    LEFT JOIN items i ON i.category = c.name AND i.checked = 0
    GROUP BY c.id
    ORDER BY c.sort_order, c.name
  `)

const listItems = (db) =>
  db.prepare(`
    SELECT i.id, i.name, i.quantity, i.category, i.checked,
           c.icon AS category_icon, c.sort_order AS category_order
    FROM items i
    JOIN categories c ON c.name = i.category
    ORDER BY c.sort_order, i.checked, LOWER(i.name)
  `)

const listTags = (db) => db.prepare('SELECT id, name, icon, sort_order FROM tags ORDER BY sort_order, name')

function withTagIds(db, items) {
  const rows = db.prepare('SELECT item_id, tag_id FROM item_tags').all()
  const map = new Map()
  for (const { item_id, tag_id } of rows) {
    if (!map.has(item_id)) map.set(item_id, [])
    map.get(item_id).push(tag_id)
  }
  return items.map((i) => ({ ...i, tag_ids: map.get(i.id) ?? [] }))
}

function replaceItemTags(db, itemId, tagIds) {
  db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(itemId)
  for (const tagId of tagIds) {
    db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)').run(itemId, tagId)
  }
}

function snapshotOf(db) {
  return {
    categories: listCategories(db).all(),
    tags: listTags(db).all(),
    items: withTagIds(db, listItems(db).all()),
  }
}

/* ------------------------------------------------------------------ */
/* Realtime (Server-Sent Events)                                       */
/* ------------------------------------------------------------------ */

const sseClients = new Map() // subdomain -> Set<Response>

const HEARTBEAT_MS = 25000

function broadcastToFamily(subdomain, payload) {
  const clients = sseClients.get(subdomain)
  if (!clients || clients.size === 0) return
  const frame = `event: snapshot\ndata: ${JSON.stringify(payload)}\n\n`
  for (const res of clients) {
    try {
      res.write(frame)
    } catch {
      /* client is gone; the close handler will clean it up */
    }
  }
}

function handleEvents(req, res) {
  let ctx
  try {
    ctx = buildCtx(req)
    ctx.host = req.headers?.host
    ctx.headers = req.headers
    ctx.cookies = []
  } catch (err) {
    return send(res, 404, { ok: false, error: { code: err.code || 'NO_FAMILY', message: err.message } })
  }
  if (!ctx.user) {
    return send(res, 401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Log in to continue' } })
  }
  if (!ctx.role) {
    return send(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: "You're not a member of this family" } })
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(`event: hello\ndata: ${JSON.stringify({ family: ctx.family.name, role: ctx.role })}\n\n`)

  let clients = sseClients.get(ctx.family.subdomain)
  if (!clients) {
    clients = new Set()
    sseClients.set(ctx.family.subdomain, clients)
  }
  clients.add(res)

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      /* ignore */
    }
  }, HEARTBEAT_MS)

  req.on('close', () => {
    clearInterval(heartbeat)
    clients.delete(res)
    if (clients.size === 0) sseClients.delete(ctx.family.subdomain)
  })
}

const getItem = (db) => db.prepare('SELECT * FROM items WHERE id = ?')
const addItemStmt = (db) =>
  db.prepare(
    'INSERT INTO items (name, quantity, category, position) VALUES (?, ?, ?, COALESCE((SELECT MAX(position) + 1 FROM items), 0))'
  )
const updateItemStmt = (db) =>
  db.prepare(
    `UPDATE items SET name = COALESCE(?, name), quantity = COALESCE(?, quantity),
       category = COALESCE(?, category), checked = COALESCE(?, checked),
       updated_at = datetime('now') WHERE id = ?`
  )
const deleteItemStmt = (db) => db.prepare('DELETE FROM items WHERE id = ?')
const clearCheckedStmt = (db) => db.prepare('DELETE FROM items WHERE checked = 1')
const catExists = (db) => db.prepare('SELECT id FROM categories WHERE name = ?')

const methods = {
  ping() {
    return { pong: Date.now() }
  },

  meta(ctx) {
    return {
      family: ctx.family,
      user: ctx.user,
      role: ctx.role,
      families: ctx.families,
      bootstrap: ctx.bootstrap,
    }
  },

  'auth.signup'(ctx, { email, password, name }) {
    const normalized = normalizeEmail(email)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw Object.assign(new Error('Enter a valid email address'), { code: 'INVALID_ARGS' })
    }
    if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
      throw Object.assign(new Error(`Password must be at least ${PASSWORD_MIN} characters`), { code: 'INVALID_ARGS' })
    }
    if (name && String(name).trim().length > 60) {
      throw Object.assign(new Error('Display name is too long'), { code: 'INVALID_ARGS' })
    }

    const existingUser = platform.prepare('SELECT * FROM users WHERE email = ?').get(normalized)
    const alreadyMember =
      existingUser &&
      platform.prepare('SELECT * FROM memberships WHERE user_id = ? AND family_id = ?').get(existingUser.id, ctx.family.id)

    // Existing member "signing up" on a family they belong to is a login.
    if (alreadyMember) {
      if (!verifyPassword(password, existingUser.password_hash)) {
        throw Object.assign(new Error('Incorrect password'), { code: 'AUTH_FAILED' })
      }
      issueSession(existingUser.id, ctx)
      return authResult(existingUser, ctx.family.subdomain)
    }

    // Who gets to join? First user of an empty family becomes admin;
    // everyone else needs an invite from an admin.
    let role = 'member'
    if (ctx.bootstrap) {
      role = 'admin'
    } else {
      const invite = platform
        .prepare('SELECT id FROM invites WHERE family_id = ? AND LOWER(email) = ?')
        .get(ctx.family.id, normalized)
      if (!invite) {
        throw Object.assign(
          new Error('This family is private — ask an admin to invite you.'),
          { code: 'FORBIDDEN' }
        )
      }
      platform.prepare('DELETE FROM invites WHERE id = ?').run(invite.id)
    }

    let user = existingUser
    if (!user) {
      const info = platform
        .prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)')
        .run(normalized, hashPassword(password), name?.trim() || null)
      user = { id: info.lastInsertRowid, email: normalized, display_name: name?.trim() || null }
    } else if (!verifyPassword(password, user.password_hash)) {
      throw Object.assign(new Error('Incorrect password'), { code: 'AUTH_FAILED' })
    }

    platform
      .prepare('INSERT INTO memberships (user_id, family_id, role) VALUES (?, ?, ?)')
      .run(user.id, ctx.family.id, role)

    issueSession(user.id, ctx)
    return authResult(user, ctx.family.subdomain)
  },

  'auth.login'(ctx, { email, password }) {
    const normalized = normalizeEmail(email)
    const user = platform.prepare('SELECT * FROM users WHERE email = ?').get(normalized)
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw Object.assign(new Error('Incorrect email or password'), { code: 'AUTH_FAILED' })
    }
    const membership = platform
      .prepare('SELECT * FROM memberships WHERE user_id = ? AND family_id = ?')
      .get(user.id, ctx.family.id)
    if (!membership) {
      throw Object.assign(new Error("You're not a member of this family"), { code: 'FORBIDDEN' })
    }
    issueSession(user.id, ctx)
    return authResult(user, ctx.family.subdomain)
  },

  'auth.logout'(ctx) {
    const token = parseCookies(ctx.headers?.cookie)[SESSION_COOKIE]
    if (token) {
      platform.prepare('DELETE FROM sessions WHERE token = ?').run(sha256(token))
    }
    destroySession(ctx)
    return { ok: true }
  },

  'auth.invite'(ctx, { email }) {
    if (ctx.role !== 'admin') {
      throw Object.assign(new Error('Only admins can invite'), { code: 'FORBIDDEN' })
    }
    const normalized = normalizeEmail(email)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw Object.assign(new Error('Enter a valid email address'), { code: 'INVALID_ARGS' })
    }
    platform
      .prepare(
        `INSERT INTO invites (family_id, email, role, created_by) VALUES (?, ?, 'member', ?)
         ON CONFLICT (family_id, email) DO NOTHING`
      )
      .run(ctx.family.id, normalized, ctx.user.id)
    return { invited: normalized }
  },

  listCategories(ctx) {
    return listCategories(ctx.db).all()
  },

  listItems(ctx) {
    return withTagIds(ctx.db, listItems(ctx.db).all())
  },

  listTags(ctx) {
    return listTags(ctx.db).all()
  },

  addTag(ctx, { name, icon }) {
    const db = ctx.db
    const n = String(name ?? '').trim()
    if (!n) throw Object.assign(new Error('Tag name is required'), { code: 'INVALID_ARGS' })
    const existing = db.prepare('SELECT * FROM tags WHERE name = ?').get(n)
    if (existing) return existing
    const order = db.prepare('SELECT COALESCE(MAX(sort_order) + 1, 99) AS n FROM tags').get().n
    const info = db.prepare('INSERT INTO tags (name, icon, sort_order) VALUES (?, ?, ?)').run(n, String(icon ?? '🏷️').trim() || '🏷️', order)
    return db.prepare('SELECT * FROM tags WHERE id = ?').get(info.lastInsertRowid)
  },

  setItemTags(ctx, id, tagIds = []) {
    const db = ctx.db
    const existing = getItem(db).get(id)
    if (!existing) throw Object.assign(new Error('Item not found'), { code: 'NOT_FOUND' })
    const clean = Array.from(new Set((Array.isArray(tagIds) ? tagIds : []).map(Number).filter(Number.isInteger)))
    replaceItemTags(db, id, clean)
    return withTagIds(db, [getItem(db).get(id)])[0]
  },

  snapshot(ctx) {
    return snapshotOf(ctx.db)
  },

  addItem(ctx, { name, quantity, category, tag_ids }) {
    const db = ctx.db
    const n = String(name ?? '').trim()
    if (!n) throw Object.assign(new Error('Name is required'), { code: 'INVALID_ARGS' })
    const qty = String(quantity ?? '1').trim() || '1'
    const cat = String(category ?? 'Other').trim() || 'Other'

    if (!catExists(db).get(cat)) {
      db.prepare('INSERT INTO categories (name) VALUES (?)').run(cat)
    }

    const info = addItemStmt(db).run(n, qty, cat)
    const id = info.lastInsertRowid
    if (Array.isArray(tag_ids) && tag_ids.length) {
      replaceItemTags(db, id, Array.from(new Set(tag_ids.map(Number).filter(Number.isInteger))))
    }
    return withTagIds(db, [getItem(db).get(id)])[0]
  },

  updateItem(ctx, id, patch = {}) {
    const db = ctx.db
    const existing = getItem(db).get(id)
    if (!existing) throw Object.assign(new Error('Item not found'), { code: 'NOT_FOUND' })

    const name = patch.name !== undefined ? String(patch.name).trim() : undefined
    if (patch.name !== undefined && !name) {
      throw Object.assign(new Error('Name cannot be empty'), { code: 'INVALID_ARGS' })
    }
    const quantity = patch.quantity !== undefined ? String(patch.quantity).trim() || '1' : undefined
    let category = patch.category !== undefined ? String(patch.category).trim() : undefined
    if (category && !catExists(db).get(category)) {
      db.prepare('INSERT INTO categories (name) VALUES (?)').run(category)
    }
    const checked = patch.checked !== undefined ? (patch.checked ? 1 : 0) : undefined

    updateItemStmt(db).run(name ?? null, quantity ?? null, category ?? null, checked ?? null, id)
    if (Array.isArray(patch.tag_ids)) {
      replaceItemTags(db, id, Array.from(new Set(patch.tag_ids.map(Number).filter(Number.isInteger))))
    }
    return withTagIds(db, [getItem(db).get(id)])[0]
  },

  setChecked(ctx, id, checked) {
    const db = ctx.db
    const existing = getItem(db).get(id)
    if (!existing) throw Object.assign(new Error('Item not found'), { code: 'NOT_FOUND' })
    updateItemStmt(db).run(null, null, null, checked ? 1 : 0, id)
    return getItem(db).get(id)
  },

  deleteItem(ctx, id) {
    deleteItemStmt(ctx.db).run(id)
    return { id }
  },

  clearChecked(ctx) {
    const info = clearCheckedStmt(ctx.db).run()
    return { removed: info.changes }
  },

  suggestions(ctx, prefix = '', limit = 8) {
    const p = `%${String(prefix).trim()}%`
    const rows = ctx.db
      .prepare(`SELECT DISTINCT name, category FROM items WHERE LOWER(name) LIKE LOWER(?) ORDER BY name LIMIT ?`)
      .all(p, Math.max(1, Math.min(20, Number(limit) || 8)))
    return rows
  },
}

/* ------------------------------------------------------------------ */
/* HTTP layer                                                           */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname)
  if (rel === '/' || rel === '') rel = '/index.html'
  let file = normalize(join(DIST, rel))
  if (!file.startsWith(DIST)) {
    res.writeHead(403)
    return res.end('Forbidden')
  }
  try {
    const info = await stat(file)
    if (info.isDirectory()) file = join(file, 'index.html')
  } catch {
    file = join(DIST, 'index.html')
  }
  try {
    const body = await readFile(file)
    const noCache = file.includes('index.html') || file.includes('sw.js') || file.endsWith('.webmanifest')
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=31536000, immutable',
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
}

const PUBLIC_METHODS = new Set(['ping', 'meta', 'auth.signup', 'auth.login', 'auth.logout'])
const MUTATING_METHODS = new Set(['addItem', 'updateItem', 'setChecked', 'deleteItem', 'clearChecked', 'addTag', 'setItemTags'])

async function handleRpc(req, res) {
  let body = ''
  for await (const chunk of req) body += chunk

  let parsed
  try {
    parsed = JSON.parse(body || '{}')
  } catch {
    return send(res, 400, { ok: false, error: { code: 'BAD_JSON', message: 'Invalid JSON body' } })
  }

  const { method, params = [] } = parsed
  const handler = methods[method]
  if (typeof handler !== 'function') {
    return send(res, 404, { ok: false, error: { code: 'UNKNOWN_METHOD', message: `Unknown method: ${method}` } })
  }

  let ctx
  try {
    ctx = buildCtx(req)
    ctx.host = req.headers?.host
    ctx.headers = req.headers
    ctx.cookies = []
  } catch (err) {
    return send(res, 404, { ok: false, error: { code: err.code || 'NO_FAMILY', message: err.message } })
  }

  // Guard protected methods. Open while a family is unclaimed (bootstrap);
  // otherwise a valid session + membership in THIS family is required.
  if (!PUBLIC_METHODS.has(method)) {
    if (ctx.user && ctx.role) {
      /* ok */
    } else if (ctx.bootstrap && !ctx.user) {
      /* open until the first member signs up */
    } else if (!ctx.user) {
      return send(res, 401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Log in to continue' } }, ctx)
    } else {
      return send(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: "You're not a member of this family" } }, ctx)
    }
  }

  try {
    const result = await handler(ctx, ...(Array.isArray(params) ? params : [params]))
    if (MUTATING_METHODS.has(method)) {
      broadcastToFamily(ctx.family.subdomain, snapshotOf(ctx.db))
    }
    send(res, 200, { ok: true, result }, ctx)
  } catch (err) {
    const status =
      err.code === 'NOT_FOUND' ? 404 : err.code === 'INVALID_ARGS' ? 400 : err.code === 'FORBIDDEN' ? 403 : err.code === 'AUTH_FAILED' ? 401 : 500
    send(res, status, { ok: false, error: { code: err.code || 'INTERNAL', message: err.message } }, ctx)
  }
}

function send(res, status, payload, ctx) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  }
  if (ctx?.cookies?.length) headers['Set-Cookie'] = ctx.cookies
  res.writeHead(status, headers)
  res.end(JSON.stringify(payload))
}

export function createApp() {
  return createServer(async (req, res) => {
    try {
      // Never build a URL from the (attacker-controlled) Host header — a
      // malformed host would throw here and leave the request hanging.
      const pathname = new URL(req.url, 'http://internal.local').pathname

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET',
          'Access-Control-Allow-Headers': 'Content-Type',
        })
        return res.end()
      }

      if (pathname === '/rpc' || pathname === '/rpc/') {
        return await handleRpc(req, res)
      }

      if (pathname === '/events') {
        return handleEvents(req, res)
      }

      return await serveStatic(req, res, pathname)
    } catch (err) {
      // Never leave a client hanging on malformed input.
      if (!res.headersSent) {
        send(res, 500, { ok: false, error: { code: 'INTERNAL', message: 'Internal error' } })
      } else {
        res.end()
      }
    }
  })
}

export {
  tenantKeyFromHost,
  buildCtx,
  getTenantDb,
  DEFAULT_SUBDOMAIN,
  DATA_DIR,
  TenantError,
  platform,
  hashPassword,
  verifyPassword,
  authResult,
}

if (import.meta.main) {
  createApp().listen(PORT, () => {
    console.log(`🍎 groceries server running → http://localhost:${PORT}`)
    console.log(`   families: {subdomain}.lvh.me:${PORT}  (default: ${DEFAULT_SUBDOMAIN})`)
  })
}
