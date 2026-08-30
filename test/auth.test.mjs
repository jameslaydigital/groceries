import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* Isolate storage before importing the server. */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'groceries-auth-test-'))
process.env.DATA_DIR = DATA_DIR
process.env.PLATFORM_DB = join(DATA_DIR, 'platform.db')
process.env.SKIP_LEGACY_ADOPTION = '1'

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

/* ---------------- helpers ---------------- */

function rpc(hostHeader, method, params = [], { cookie } = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ method, params })
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      ...(hostHeader !== undefined ? { Host: hostHeader } : {}),
    }
    if (cookie) headers.Cookie = cookie
    const req = http.request({ host: '127.0.0.1', port, path: '/rpc', method: 'POST', headers }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        let json = null
        try {
          json = JSON.parse(data)
        } catch {
          /* non-JSON */
        }
        const setCookie = res.headers['set-cookie']
        resolve({ status: res.statusCode, json, setCookie })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

const cookieFrom = (setCookie) => {
  const c = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return c ? c.split(';')[0] : ''
}

// A public helper used to provision users for multi-family scenarios.
function insertUser(email, password, name) {
  const info = platform
    .prepare('INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)')
    .run(email, hashPassword(password), name)
  return info.lastInsertRowid
}
function addMembership(userId, familyId, role = 'member') {
  platform
    .prepare('INSERT INTO memberships (user_id, family_id, role) VALUES (?, ?, ?)')
    .run(userId, familyId, role)
}
const familyIdFor = (subdomain) => platform.prepare('SELECT id FROM families WHERE subdomain = ?').get(subdomain).id

/* ---------------- bootstrap mode ---------------- */

describe('bootstrap mode (unclaimed family)', () => {
  it('serves data to anonymous visitors until someone signs up', async () => {
    const res = await rpc('home.lvh.me', 'snapshot')
    assert.equal(res.status, 200)
    assert.equal(res.json.ok, true)
  })
})

/* ---------------- signup ---------------- */

describe('auth.signup', () => {
  it('first user of a family becomes admin and gets a session cookie', async () => {
    const res = await rpc('home.lvh.me', 'auth.signup', [{ email: 'jane@example.com', password: 'hunter2secret', name: 'Jane' }])
    assert.equal(res.status, 200)
    assert.equal(res.json.result.role, 'admin')
    assert.equal(res.json.result.user.email, 'jane@example.com')
    assert.ok(res.setCookie, 'sets a session cookie')
    const cookie = cookieFrom(res.setCookie)
    assert.ok(cookie.startsWith('groceries.session='))
    assert.match(String(res.setCookie), /HttpOnly/)
    assert.match(String(res.setCookie), /SameSite=Lax/)
  })

  it('does not store the plaintext password', () => {
    const row = platform.prepare('SELECT password_hash FROM users WHERE email = ?').get('jane@example.com')
    assert.ok(row.password_hash.startsWith('scrypt:'))
    assert.ok(!row.password_hash.includes('hunter2secret'))
  })

  it('rejects weak passwords and bad emails', async () => {
    const short = await rpc('home.lvh.me', 'auth.signup', [{ email: 'x@example.com', password: 'short' }])
    assert.equal(short.status, 400)
    assert.equal(short.json.error.code, 'INVALID_ARGS')
    const bad = await rpc('home.lvh.me', 'auth.signup', [{ email: 'not-an-email', password: 'hunter2secret' }])
    assert.equal(bad.status, 400)
  })

  it('rejects a second signup without an invite once the family is claimed', async () => {
    const res = await rpc('home.lvh.me', 'auth.signup', [{ email: 'bob@example.com', password: 'hunter2secret' }])
    assert.equal(res.status, 403)
    assert.equal(res.json.error.code, 'FORBIDDEN')
  })

  it('accepts a signup after an admin invites the email', async () => {
    const admin = await rpc('home.lvh.me', 'auth.login', [{ email: 'jane@example.com', password: 'hunter2secret' }])
    const invite = await rpc('home.lvh.me', 'auth.invite', [{ email: 'bob@example.com' }], { cookie: cookieFrom(admin.setCookie) })
    assert.equal(invite.status, 200)

    const res = await rpc('home.lvh.me', 'auth.signup', [{ email: 'bob@example.com', password: 'hunter2secret' }])
    assert.equal(res.status, 200)
    assert.equal(res.json.result.role, 'member')
  })

  it('only admins can invite', async () => {
    const bob = await rpc('home.lvh.me', 'auth.login', [{ email: 'bob@example.com', password: 'hunter2secret' }])
    const res = await rpc('home.lvh.me', 'auth.invite', [{ email: 'carol@example.com' }], { cookie: cookieFrom(bob.setCookie) })
    assert.equal(res.status, 403)
    assert.equal(res.json.error.code, 'FORBIDDEN')
  })
})

/* ---------------- login / logout ---------------- */

describe('auth.login', () => {
  it('logs in with correct credentials', async () => {
    const res = await rpc('home.lvh.me', 'auth.login', [{ email: 'jane@example.com', password: 'hunter2secret' }])
    assert.equal(res.status, 200)
    assert.equal(res.json.result.user.email, 'jane@example.com')
    assert.ok(res.setCookie)
  })

  it('rejects wrong passwords', async () => {
    const res = await rpc('home.lvh.me', 'auth.login', [{ email: 'jane@example.com', password: 'wrongpassword' }])
    assert.equal(res.status, 401)
    assert.equal(res.json.error.code, 'AUTH_FAILED')
  })

  it('rejects a user who is not a member of this family', async () => {
    const res = await rpc('home.lvh.me', 'auth.login', [{ email: 'stranger@example.com', password: 'hunter2secret' }])
    assert.equal(res.status, 401)
    assert.equal(res.json.error.code, 'AUTH_FAILED')
  })

  it('logout clears the session', async () => {
    const login = await rpc('home.lvh.me', 'auth.login', [{ email: 'jane@example.com', password: 'hunter2secret' }])
    const cookie = cookieFrom(login.setCookie)
    const logout = await rpc('home.lvh.me', 'auth.logout', [], { cookie })
    assert.equal(logout.status, 200)
    assert.match(String(logout.setCookie), /Max-Age=0/)
    // the token is gone from the sessions table
    const after = await rpc('home.lvh.me', 'meta', [], { cookie })
    assert.equal(after.json.result.user, null)
  })
})

/* ---------------- guards ---------------- */

describe('auth guard', () => {
  it('returns 401 for protected methods once the family is claimed', async () => {
    const res = await rpc('home.lvh.me', 'snapshot')
    assert.equal(res.status, 401)
    assert.equal(res.json.error.code, 'AUTH_REQUIRED')
  })

  it('returns 403 for a valid session that is not a member of this family', async () => {
    // create a second family and a user who belongs only to it
    const other = platform.prepare('INSERT INTO families (subdomain, name) VALUES (?, ?)').run('other', 'Other Family')
    const userId = insertUser('carol@example.com', 'hunter2secret', 'Carol')
    addMembership(userId, other.lastInsertRowid, 'admin')

    const login = await rpc('other.lvh.me', 'auth.login', [{ email: 'carol@example.com', password: 'hunter2secret' }])
    assert.equal(login.status, 200)

    // same cookie is scoped to the parent domain, so visiting home.lvh.me with it is possible
    const res = await rpc('home.lvh.me', 'snapshot', [], { cookie: cookieFrom(login.setCookie) })
    assert.equal(res.status, 403)
    assert.equal(res.json.error.code, 'FORBIDDEN')
  })

  it('lets a member through with their cookie', async () => {
    const login = await rpc('home.lvh.me', 'auth.login', [{ email: 'jane@example.com', password: 'hunter2secret' }])
    const res = await rpc('home.lvh.me', 'snapshot', [], { cookie: cookieFrom(login.setCookie) })
    assert.equal(res.status, 200)
    assert.equal(res.json.ok, true)
  })
})

/* ---------------- multi-family ---------------- */

describe('multi-family', () => {
  it('meta reports all families a user belongs to', async () => {
    // carol belongs to "other"; add her to "home" too
    const homeId = familyIdFor('home')
    const carol = platform.prepare('SELECT id FROM users WHERE email = ?').get('carol@example.com')
    addMembership(carol.id, homeId, 'member')

    const login = await rpc('home.lvh.me', 'auth.login', [{ email: 'carol@example.com', password: 'hunter2secret' }])
    const meta = await rpc('home.lvh.me', 'meta', [], { cookie: cookieFrom(login.setCookie) })
    const subs = meta.json.result.families.map((f) => f.subdomain)
    assert.ok(subs.includes('home'))
    assert.ok(subs.includes('other'))
    assert.equal(meta.json.result.role, 'member')
  })
})
