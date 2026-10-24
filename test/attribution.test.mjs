import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DATA_DIR = mkdtempSync(join(tmpdir(), 'groceries-attribution-test-'))
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
const actor = (item) => ({ id: item.added_by.id, name: item.added_by.name })

describe('item attribution', () => {
  let james
  let amy
  let jamesId
  let amyId

  before(async () => {
    const s = await rpc('home.lvh.me', 'auth.signup', [{ email: 'james@example.com', password: 'hunter2secret', name: 'James' }])
    james = cookieFrom(s.setCookie)
    const inv = await rpc('home.lvh.me', 'auth.invite', [{ email: 'amy@example.com' }], { cookie: james })
    const token = inv.json.result.token
    const a = await rpc('home.lvh.me', 'auth.signup', [{ email: 'amy@example.com', password: 'hunter2secret', name: 'Amy', token }])
    amy = cookieFrom(a.setCookie)
    const mj = await rpc('home.lvh.me', 'meta', [], { cookie: james })
    jamesId = mj.json.result.user.id
    const ma = await rpc('home.lvh.me', 'meta', [], { cookie: amy })
    amyId = ma.json.result.user.id
  })

  it('addItem records added_by as a resolved actor', async () => {
    const added = await rpc('home.lvh.me', 'addItem', [{ name: 'Bagels', quantity: '1', category: 'Bakery' }], { cookie: james })
    assert.equal(added.status, 200)
    assert.deepEqual(actor(added.json.result), { id: jamesId, name: 'James' })

    const snap = await rpc('home.lvh.me', 'snapshot', [], { cookie: james })
    const bagels = snap.json.result.items.find((i) => i.name === 'Bagels')
    assert.deepEqual(bagels.added_by, { id: jamesId, name: 'James' })
    assert.equal(bagels.checked_by, null)
  })

  it('checking off attributes checked_by to the checker', async () => {
    const snap = await rpc('home.lvh.me', 'snapshot', [], { cookie: james })
    const bagels = snap.json.result.items.find((i) => i.name === 'Bagels')

    const res = await rpc('home.lvh.me', 'setChecked', [bagels.id, true], { cookie: amy })
    assert.equal(res.status, 200)
    assert.equal(res.json.result.checked, 1)
    assert.deepEqual(res.json.result.checked_by, { id: amyId, name: 'Amy' })
  })

  it('actor ids are never leaked as raw integers', async () => {
    const snap = await rpc('home.lvh.me', 'snapshot', [], { cookie: james })
    for (const item of snap.json.result.items) {
      assert.ok(item.added_by === null || typeof item.added_by === 'object')
      assert.ok(item.checked_by === null || typeof item.checked_by === 'object')
    }
  })

  it('recentActivity lists adds and checks newest first with actors', async () => {
    await rpc('home.lvh.me', 'addItem', [{ name: 'Cream Cheese', quantity: '1', category: 'Dairy' }], { cookie: james })

    const feed = await rpc('home.lvh.me', 'recentActivity', [], { cookie: james })
    assert.equal(feed.status, 200)
    const acts = feed.json.result
    assert.ok(acts.length >= 3)
    assert.deepEqual(
      acts.slice(0, 3).map((a) => ({ type: a.type, item: a.item, name: a.user?.name })),
      [
        { type: 'add', item: 'Cream Cheese', name: 'James' },
        { type: 'check', item: 'Bagels', name: 'Amy' },
        { type: 'add', item: 'Bagels', name: 'James' },
      ]
    )
    for (const a of acts) assert.equal(typeof a.user, 'object')
  })

  it('clearChecked logs a clear event and removes checked rows', async () => {
    const res = await rpc('home.lvh.me', 'clearChecked', [], { cookie: james })
    assert.equal(res.json.result.removed, 1)

    const feed = await rpc('home.lvh.me', 'recentActivity', [], { cookie: james })
    const top = feed.json.result[0]
    assert.equal(top.type, 'clear')
    assert.equal(top.item, '1')
    assert.equal(top.user.name, 'James')

    const snap = await rpc('home.lvh.me', 'snapshot', [], { cookie: james })
    assert.ok(!snap.json.result.items.some((i) => i.name === 'Bagels'))
    assert.ok(snap.json.result.items.some((i) => i.name === 'Cream Cheese'))
  })

  it('unchecking does not log a check event', async () => {
    const snap = await rpc('home.lvh.me', 'snapshot', [], { cookie: james })
    const cc = snap.json.result.items.find((i) => i.name === 'Cream Cheese')
    await rpc('home.lvh.me', 'setChecked', [cc.id, true], { cookie: amy })
    await rpc('home.lvh.me', 'setChecked', [cc.id, false], { cookie: amy })

    const before = (await rpc('home.lvh.me', 'recentActivity', [], { cookie: james })).json.result
    const checks = before.filter((a) => a.type === 'check' && a.item === 'Cream Cheese')
    assert.equal(checks.length, 1, 'only the initial check is logged')
  })

  it('recentActivity requires auth', async () => {
    const res = await rpc('home.lvh.me', 'recentActivity', [])
    assert.equal(res.status, 401)
  })
})
