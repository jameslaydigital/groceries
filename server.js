import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

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

function buildCtx(host) {
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
  // Phase 1 (auth) will populate `user` and `families` from the session cookie.
  return { db, family, user: null, families: [] }
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
    return { family: ctx.family, user: ctx.user, families: ctx.families }
  },

  listCategories(ctx) {
    return listCategories(ctx.db).all()
  },

  listItems(ctx) {
    return listItems(ctx.db).all()
  },

  snapshot(ctx) {
    return {
      categories: listCategories(ctx.db).all(),
      items: listItems(ctx.db).all(),
    }
  },

  addItem(ctx, { name, quantity, category }) {
    const db = ctx.db
    const n = String(name ?? '').trim()
    if (!n) throw Object.assign(new Error('Name is required'), { code: 'INVALID_ARGS' })
    const qty = String(quantity ?? '1').trim() || '1'
    const cat = String(category ?? 'Other').trim() || 'Other'

    if (!catExists(db).get(cat)) {
      db.prepare('INSERT INTO categories (name) VALUES (?)').run(cat)
    }

    const info = addItemStmt(db).run(n, qty, cat)
    return getItem(db).get(info.lastInsertRowid)
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
    return getItem(db).get(id)
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
    ctx = buildCtx(req.headers.host)
  } catch (err) {
    return send(res, 404, { ok: false, error: { code: err.code || 'NO_FAMILY', message: err.message } })
  }

  try {
    const result = await handler(ctx, ...(Array.isArray(params) ? params : [params]))
    send(res, 200, { ok: true, result })
  } catch (err) {
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'INVALID_ARGS' ? 400 : 500
    send(res, status, { ok: false, error: { code: err.code || 'INTERNAL', message: err.message } })
  }
}

function send(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  })
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

export { tenantKeyFromHost, buildCtx, getTenantDb, DEFAULT_SUBDOMAIN, DATA_DIR, TenantError }

if (import.meta.main) {
  createApp().listen(PORT, () => {
    console.log(`🍎 groceries server running → http://localhost:${PORT}`)
    console.log(`   families: {subdomain}.lvh.me:${PORT}  (default: ${DEFAULT_SUBDOMAIN})`)
  })
}
