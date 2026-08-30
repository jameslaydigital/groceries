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
process.env.AUTH_RATE_MS = '1000'

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
  it('allows one failed attempt per second', async () => {
    addMember('alice@example.com')
    const first = await rpc('home.lvh.me', 'auth.login', [{ email: 'alice@example.com', password: 'wrong' }], { ip: '10.0.0.1' })
    assert.equal(first.status, 401)
    // an immediate retry is throttled
    const second = await rpc('home.lvh.me', 'auth.login', [{ email: 'alice@example.com', password: 'wrong' }], { ip: '10.0.0.1' })
    assert.equal(second.status, 429)
    // after a second passes, a new attempt is allowed
    await new Promise((r) => setTimeout(r, 1100))
    const third = await rpc('home.lvh.me', 'auth.login', [{ email: 'alice@example.com', password: 'wrong' }], { ip: '10.0.0.1' })
    assert.equal(third.status, 401)
  })

  it('a successful login clears the throttle', async () => {
    // wait for alice's email throttle to expire from the previous test
    await new Promise((r) => setTimeout(r, 1100))
    const ok = await rpc('home.lvh.me', 'auth.login', [{ email: 'alice@example.com', password: 'hunter2secret' }], { ip: '10.0.0.2' })
    assert.equal(ok.status, 200)
    // success clears the throttle: an immediate correct login also works
    const again = await rpc('home.lvh.me', 'auth.login', [{ email: 'alice@example.com', password: 'hunter2secret' }], { ip: '10.0.0.2' })
    assert.equal(again.status, 200)
  })

  it('the throttle is per-email across IPs', async () => {
    addMember('carol@example.com')
    const a = await rpc('home.lvh.me', 'auth.login', [{ email: 'carol@example.com', password: 'wrong' }], { ip: '10.0.0.3' })
    assert.equal(a.status, 401)
    // same email from a different IP is still throttled within the same second
    const b = await rpc('home.lvh.me', 'auth.login', [{ email: 'carol@example.com', password: 'hunter2secret' }], { ip: '10.0.0.4' })
    assert.equal(b.status, 429)
  })
})

describe('session storage', () => {
  it('stores only a sha256 hash of the session token', async () => {
    addMember('dave@example.com')
    const res = await rpc('home.lvh.me', 'auth.login', [{ email: 'dave@example.com', password: 'hunter2secret' }], { ip: '10.0.0.4' })
    const raw = cookieFrom(res.setCookie).replace('groceries.session=', '')
    const row = platform.prepare('SELECT token FROM sessions ORDER BY rowid DESC LIMIT 1').get()
    assert.notEqual(row.token, raw)
    assert.match(row.token, /^[0-9a-f]{64}$/)
    const count = platform.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token = ?').get(raw)
    assert.equal(count.n, 0, 'raw token must never be stored')
  })

  it('rejects expired sessions', async () => {
    const res = await rpc('home.lvh.me', 'auth.login', [{ email: 'dave@example.com', password: 'hunter2secret' }], { ip: '10.0.0.5' })
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
