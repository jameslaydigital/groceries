import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const DIST = join(ROOT, 'dist')
const PORT = process.env.PORT || 8787

const db = new DatabaseSync(join(ROOT, 'groceries.db'))

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS categories (
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
  CREATE INDEX IF NOT EXISTS idx_items_checked ON items(checked);
`)

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

const seed = db.prepare('SELECT COUNT(*) AS n FROM categories').get()
if (seed.n === 0) {
  const ins = db.prepare('INSERT INTO categories (name, icon, sort_order) VALUES (?, ?, ?)')
  for (const c of DEFAULT_CATEGORIES) ins.run(...c)
}

const listCategories = db.prepare(`
  SELECT c.name, c.icon, c.sort_order, COUNT(i.id) AS item_count
  FROM categories c
  LEFT JOIN items i ON i.category = c.name AND i.checked = 0
  GROUP BY c.id
  ORDER BY c.sort_order, c.name
`)

const listItems = db.prepare(`
  SELECT i.id, i.name, i.quantity, i.category, i.checked,
         c.icon AS category_icon, c.sort_order AS category_order
  FROM items i
  JOIN categories c ON c.name = i.category
  ORDER BY c.sort_order, i.checked, LOWER(i.name)
`)

const getItem = db.prepare('SELECT * FROM items WHERE id = ?')
const addItemStmt = db.prepare(
  'INSERT INTO items (name, quantity, category, position) VALUES (?, ?, ?, COALESCE((SELECT MAX(position) + 1 FROM items), 0))'
)
const updateItemStmt = db.prepare(
  `UPDATE items SET name = COALESCE(?, name), quantity = COALESCE(?, quantity),
     category = COALESCE(?, category), checked = COALESCE(?, checked),
     updated_at = datetime('now') WHERE id = ?`
)
const deleteItemStmt = db.prepare('DELETE FROM items WHERE id = ?')
const clearCheckedStmt = db.prepare('DELETE FROM items WHERE checked = 1')

const methods = {
  async ping() {
    return { pong: Date.now() }
  },

  async listCategories() {
    return listCategories.all()
  },

  async listItems() {
    return listItems.all()
  },

  async snapshot() {
    return {
      categories: listCategories.all(),
      items: listItems.all(),
    }
  },

  async addItem({ name, quantity, category }) {
    const n = String(name ?? '').trim()
    if (!n) throw Object.assign(new Error('Name is required'), { code: 'INVALID_ARGS' })
    const qty = String(quantity ?? '1').trim() || '1'
    const cat = String(category ?? 'Other').trim() || 'Other'

    const catExists = db.prepare('SELECT id FROM categories WHERE name = ?').get(cat)
    if (!catExists) {
      db.prepare('INSERT INTO categories (name) VALUES (?)').run(cat)
    }

    const info = addItemStmt.run(n, qty, cat)
    return getItem.get(info.lastInsertRowid)
  },

  async updateItem(id, patch = {}) {
    const existing = getItem.get(id)
    if (!existing) throw Object.assign(new Error('Item not found'), { code: 'NOT_FOUND' })

    const name = patch.name !== undefined ? String(patch.name).trim() : undefined
    if (patch.name !== undefined && !name) {
      throw Object.assign(new Error('Name cannot be empty'), { code: 'INVALID_ARGS' })
    }
    const quantity = patch.quantity !== undefined ? String(patch.quantity).trim() || '1' : undefined
    let category = patch.category !== undefined ? String(patch.category).trim() : undefined
    if (category && !db.prepare('SELECT id FROM categories WHERE name = ?').get(category)) {
      db.prepare('INSERT INTO categories (name) VALUES (?)').run(category)
    }
    const checked = patch.checked !== undefined ? (patch.checked ? 1 : 0) : undefined

    updateItemStmt.run(name ?? null, quantity ?? null, category ?? null, checked ?? null, id)
    return getItem.get(id)
  },

  async setChecked(id, checked) {
    const existing = getItem.get(id)
    if (!existing) throw Object.assign(new Error('Item not found'), { code: 'NOT_FOUND' })
    updateItemStmt.run(null, null, null, checked ? 1 : 0, id)
    return getItem.get(id)
  },

  async deleteItem(id) {
    deleteItemStmt.run(id)
    return { id }
  },

  async clearChecked() {
    const info = clearCheckedStmt.run()
    return { removed: info.changes }
  },

  async suggestions(prefix = '', limit = 8) {
    const p = `%${String(prefix).trim()}%`
    const rows = db
      .prepare(`SELECT DISTINCT name, category FROM items WHERE LOWER(name) LIKE LOWER(?) ORDER BY name LIMIT ?`)
      .all(p, Math.max(1, Math.min(20, Number(limit) || 8)))
    return rows
  },
}

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

  try {
    const result = await handler(...(Array.isArray(params) ? params : [params]))
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET', 'Access-Control-Allow-Headers': 'Content-Type' })
    return res.end()
  }

  if (pathname === '/rpc' || pathname === '/rpc/') {
    return handleRpc(req, res)
  }

  return serveStatic(req, res, pathname)
})

server.listen(PORT, () => {
  console.log(`🍎 groceries server running → http://localhost:${PORT}`)
})
