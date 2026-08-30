import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DATA_DIR = mkdtempSync(join(tmpdir(), 'groceries-hardening-test-'))
process.env.DATA_DIR = DATA_DIR
process.env.PLATFORM_DB = join(DATA_DIR, 'platform.db')
process.env.SKIP_LEGACY_ADOPTION = '1'
process.env.AUTH_RATE_MAX = '5'

const { createApp, platform, hashPassword } = await import('../server.js')

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

function rpc(host, method, params = [], { cookie, ip } = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ method, params })
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...(host ? { Host: host } : {}) }
    if (cookie) headers.Cookie = cookie
    if (ip) headers['X-Forwarded-For'] = ip
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

function addMember(email) {
  const home = platform.prepare('SELECT id FROM families WHERE subdomain = ?').get('home')
  const info = platform
    .prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)')
    .run(email, hashPassword('hunter2secret'), 'Member')
  platform.prepare('INSERT INTO memberships (user_id, family_id, role) VALUES (?, ?, ?)').run(info.lastInsertRowid, home.id, 'member')
  return email
}

describe('brute-force protection', () => {
  it('locks out an IP after too many failed logins', async () => {
    addMember('alice@example.com')
    const statuses = []
    for (let i = 0; i < 6; i++) {
      const res = await rpc('home.lvh.me', 'auth.login', [{ email: 'alice@example.com', password: 'wrong' }], { ip: '10.0.0.1' })
      statuses.push(res.status)
    }
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429])
    assert.equal((await rpc('home.lvh.me', 'auth.login', [{ email: 'alice@example.com', password: 'wrong' }], { ip: '10.0.0.1' })).status, 429)
  })

  it('locks the account even from a different IP', async () => {
    // alice's email bucket is at 5 from the previous test, so a correct
    // password from a clean IP is still rejected until the window resets.
    const res = await rpc('home.lvh.me', 'auth.login', [{ email: 'alice@example.com', password: 'hunter2secret' }], { ip: '10.0.0.2' })
    assert.equal(res.status, 429)
  })

  it('a clean account on a clean IP still works', async () => {
    addMember('bob@example.com')
    const res = await rpc('home.lvh.me', 'auth.login', [{ email: 'bob@example.com', password: 'hunter2secret' }], { ip: '10.0.0.3' })
    assert.equal(res.status, 200)
  })

  it('an IP locked by one account stays locked for others', async () => {
    const res = await rpc('home.lvh.me', 'auth.login', [{ email: 'bob@example.com', password: 'hunter2secret' }], { ip: '10.0.0.1' })
    assert.equal(res.status, 429)
  })
})

describe('session storage', () => {
  it('stores only a sha256 hash of the session token', async () => {
    const res = await rpc('home.lvh.me', 'auth.login', [{ email: 'bob@example.com', password: 'hunter2secret' }], { ip: '10.0.0.4' })
    const raw = cookieFrom(res.setCookie).replace('groceries.session=', '')
    const row = platform.prepare('SELECT token FROM sessions ORDER BY rowid DESC LIMIT 1').get()
    assert.notEqual(row.token, raw)
    assert.match(row.token, /^[0-9a-f]{64}$/)
    const count = platform.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token = ?').get(raw)
    assert.equal(count.n, 0, 'raw token must never be stored')
  })

  it('rejects expired sessions', async () => {
    const res = await rpc('home.lvh.me', 'auth.login', [{ email: 'bob@example.com', password: 'hunter2secret' }], { ip: '10.0.0.5' })
    const cookie = cookieFrom(res.setCookie)
    platform
      .prepare("UPDATE sessions SET expires_at = datetime('now', '-1 day') WHERE rowid = (SELECT MAX(rowid) FROM sessions)")
      .run()
    const meta = await rpc('home.lvh.me', 'meta', [], { cookie })
    assert.equal(meta.json.result.user, null)
    const snap = await rpc('home.lvh.me', 'snapshot', [], { cookie })
    assert.equal(snap.status, 401)
  })
})
