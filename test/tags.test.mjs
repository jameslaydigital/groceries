import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DATA_DIR = mkdtempSync(join(tmpdir(), 'groceries-tags-test-'))
process.env.DATA_DIR = DATA_DIR
process.env.PLATFORM_DB = join(DATA_DIR, 'platform.db')
process.env.SKIP_LEGACY_ADOPTION = '1'

const { createApp } = await import('../server.js')

let server
let port

before(async () => {
  server = createApp()
  await new Promise((resolve) => server.listen(0, resolve))
  port = server.address().port
})

after(() => {
  server?.close()
  rmSync(DATA_DIR, { recursive: true, force: true })
})

function rpc(host, method, params = [], { cookie } = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ method, params })
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...(host ? { Host: host } : {}) }
    if (cookie) headers.Cookie = cookie
    const req = http.request({ host: '127.0.0.1', port, path: '/rpc', method: 'POST', headers }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        let json = null
        try {
          json = JSON.parse(data)
        } catch {
          /* */
        }
        resolve({ status: res.statusCode, json, setCookie: res.headers['set-cookie'] })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

const cookieFrom = (setCookie) => (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]

describe('tags', () => {
  let cookie

  before(async () => {
    const res = await rpc('home.lvh.me', 'auth.signup', [{ email: 'tagadmin@example.com', password: 'hunter2secret', name: 'T' }])
    cookie = cookieFrom(res.setCookie)
  })

  it('seeds default store tags per family', async () => {
    const res = await rpc('home.lvh.me', 'listTags', [], { cookie })
    const names = res.json.result.map((t) => t.name)
    assert.deepEqual(names, ['Costco', "Trader Joe's", "Smith's"])
    assert.ok(res.json.result.every((t) => t.icon))
  })

  it('adds an item with tags', async () => {
    const tags = await rpc('home.lvh.me', 'listTags', [], { cookie })
    const costco = tags.json.result.find((t) => t.name === 'Costco')
    const tj = tags.json.result.find((t) => t.name === "Trader Joe's")

    const res = await rpc('home.lvh.me', 'addItem', [{ name: 'Rotisserie Chicken', quantity: '1', category: 'Meat & Seafood', tag_ids: [costco.id, tj.id] }], { cookie })
    assert.equal(res.json.ok, true)
    assert.deepEqual(res.json.result.tag_ids.sort(), [costco.id, tj.id].sort())
  })

  it('snapshot includes tags and per-item tag ids', async () => {
    const snap = await rpc('home.lvh.me', 'snapshot', [], { cookie })
    assert.ok(snap.json.result.tags.length >= 3)
    const chicken = snap.json.result.items.find((i) => i.name === 'Rotisserie Chicken')
    assert.ok(chicken.tag_ids.length === 2)
  })

  it('setItemTags replaces an item’s tags', async () => {
    const snap = await rpc('home.lvh.me', 'snapshot', [], { cookie })
    const chicken = snap.json.result.items.find((i) => i.name === 'Rotisserie Chicken')
    const tags = snap.json.result.tags
    const smiths = tags.find((t) => t.name === "Smith's")

    const res = await rpc('home.lvh.me', 'setItemTags', [chicken.id, [smiths.id]], { cookie })
    assert.deepEqual(res.json.result.tag_ids, [smiths.id])
  })

  it('adds a custom tag', async () => {
    const res = await rpc('home.lvh.me', 'addTag', [{ name: 'Farmers Market', icon: '🧑‍🌾' }], { cookie })
    assert.equal(res.json.result.name, 'Farmers Market')
    assert.equal(res.json.result.icon, '🧑‍🌾')
  })

  it('tags are isolated per family', async () => {
    const res = await rpc('other.lvh.me', 'listTags', [], {})
    assert.equal(res.status, 404) // no family
  })

  it('rejects tag mutation without auth', async () => {
    const res = await rpc('home.lvh.me', 'setItemTags', [1, []])
    assert.equal(res.status, 401)
    assert.equal(res.json.error.code, 'AUTH_REQUIRED')
  })
})
