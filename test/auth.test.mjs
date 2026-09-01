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
process.env.AUTH_RATE_MS = '1'

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

// AUTH_RATE_MS=1 makes the brute-force window just 1ms, so a failed attempt
// and the next login can land in the same millisecond and trip the limiter.
// Sleep 2ms after any throttling assertion so the window always elapses.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
    await sleep(2)
  })

  it('accepts a signup after an admin invites the email', async () => {
    const admin = await rpc('home.lvh.me', 'auth.login', [{ email: 'jane@example.com', password: 'hunter2secret' }])
    const invite = await rpc('home.lvh.me', 'auth.invite', [{ email: 'bob@example.com' }], { cookie: cookieFrom(admin.setCookie) })
    assert.equal(invite.status, 200)
    assert.ok(invite.json.result.token, 'invite includes a secure token')

    const res = await rpc('home.lvh.me', 'auth.signup', [
      { email: 'bob@example.com', password: 'hunter2secret', token: invite.json.result.token },
    ])
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
    await sleep(2)
  })

  it('rejects a user who is not a member of this family', async () => {
    const res = await rpc('home.lvh.me', 'auth.login', [{ email: 'stranger@example.com', password: 'hunter2secret' }])
    assert.equal(res.status, 401)
    assert.equal(res.json.error.code, 'AUTH_FAILED')
    await sleep(2)
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

/* ---------------- members & invites ---------------- */

describe('members & invites', () => {
  let adminCookie
  let memberCookie

  before(async () => {
    const admin = await rpc('home.lvh.me', 'auth.login', [{ email: 'jane@example.com', password: 'hunter2secret' }])
    adminCookie = cookieFrom(admin.setCookie)
    const member = await rpc('home.lvh.me', 'auth.login', [{ email: 'bob@example.com', password: 'hunter2secret' }])
    memberCookie = cookieFrom(member.setCookie)
  })

  it('listMembers returns the roster plus pending invites', async () => {
    const invited = await rpc('home.lvh.me', 'auth.invite', [{ email: 'dave@example.com' }], { cookie: adminCookie })
    assert.equal(invited.status, 200)

    const res = await rpc('home.lvh.me', 'listMembers', [], { cookie: adminCookie })
    assert.equal(res.status, 200)
    const { members, invites } = res.json.result
    const emails = members.map((m) => m.email)
    assert.ok(emails.includes('jane@example.com'))
    assert.ok(emails.includes('bob@example.com'))
    const admin = members.find((m) => m.email === 'jane@example.com')
    assert.equal(admin.role, 'admin')
    const invitedEmails = invites.map((i) => i.email)
    assert.ok(invitedEmails.includes('dave@example.com'))
  })

  it('any member can list members; only admins can revoke invites', async () => {
    const asMember = await rpc('home.lvh.me', 'listMembers', [], { cookie: memberCookie })
    assert.equal(asMember.status, 200)
    assert.ok(asMember.json.result.members.some((m) => m.email === 'jane@example.com'))

    const invite = await rpc('home.lvh.me', 'listMembers', [], { cookie: adminCookie })
    const target = invite.json.result.invites.find((i) => i.email === 'dave@example.com')

    const blocked = await rpc('home.lvh.me', 'revokeInvite', [{ id: target.id }], { cookie: memberCookie })
    assert.equal(blocked.status, 403)

    const revoked = await rpc('home.lvh.me', 'revokeInvite', [{ id: target.id }], { cookie: adminCookie })
    assert.equal(revoked.status, 200)
    assert.equal(revoked.json.result.revoked, true)

    const after = await rpc('home.lvh.me', 'listMembers', [], { cookie: adminCookie })
    assert.ok(!after.json.result.invites.some((i) => i.email === 'dave@example.com'))
  })

  it('revoking a missing invite reports revoked:false', async () => {
    const res = await rpc('home.lvh.me', 'revokeInvite', [{ id: 999999 }], { cookie: adminCookie })
    assert.equal(res.status, 200)
    assert.equal(res.json.result.revoked, false)
  })
})

/* ---------------- invite links (token flow) ---------------- */

describe('invite links', () => {
  let adminCookie

  before(async () => {
    const admin = await rpc('home.lvh.me', 'auth.login', [{ email: 'jane@example.com', password: 'hunter2secret' }])
    adminCookie = cookieFrom(admin.setCookie)
  })

  it('auth.inviteInfo resolves a valid token to the family', async () => {
    const invite = await rpc('home.lvh.me', 'auth.invite', [{ email: 'erin@example.com' }], { cookie: adminCookie })
    const res = await rpc('home.lvh.me', 'auth.inviteInfo', [{ token: invite.json.result.token }])
    assert.equal(res.status, 200)
    assert.equal(res.json.result.valid, true)
    assert.equal(res.json.result.email, 'erin@example.com')
    assert.equal(res.json.result.family.subdomain, 'home')
  })

  it('auth.inviteInfo is public and rejects bogus tokens', async () => {
    const res = await rpc('home.lvh.me', 'auth.inviteInfo', [{ token: 'not-a-real-token' }])
    assert.equal(res.status, 200)
    assert.equal(res.json.result.valid, false)
  })

  it('signup with a token joins the family and consumes it', async () => {
    const invite = await rpc('home.lvh.me', 'auth.invite', [{ email: 'erin@example.com' }], { cookie: adminCookie })
    const token = invite.json.result.token
    const res = await rpc('home.lvh.me', 'auth.signup', [
      { email: 'erin@example.com', password: 'hunter2secret', token },
    ])
    assert.equal(res.status, 200)
    assert.equal(res.json.result.role, 'member')

    // the token is single-use
    const again = await rpc('home.lvh.me', 'auth.signup', [
      { email: 'erin@example.com', password: 'hunter2secret', token },
    ])
    assert.equal(again.status, 403)
    assert.equal(again.json.error.code, 'FORBIDDEN')
    await sleep(2)
  })

  it('a revoked invite no longer works', async () => {
    const invite = await rpc('home.lvh.me', 'auth.invite', [{ email: 'frank@example.com' }], { cookie: adminCookie })
    const listed = await rpc('home.lvh.me', 'listMembers', [], { cookie: adminCookie })
    const row = listed.json.result.invites.find((i) => i.email === 'frank@example.com')
    assert.ok(row.token, 'admins see invite tokens')
    await rpc('home.lvh.me', 'revokeInvite', [{ id: row.id }], { cookie: adminCookie })

    const res = await rpc('home.lvh.me', 'auth.signup', [
      { email: 'frank@example.com', password: 'hunter2secret', token: invite.json.result.token },
    ])
    assert.equal(res.status, 403)
    assert.equal(res.json.error.code, 'FORBIDDEN')
    await sleep(2)
  })

  it('any email can use an invite link — the token is the gate', async () => {
    const invite = await rpc('home.lvh.me', 'auth.invite', [{ email: 'grace@example.com' }], { cookie: adminCookie })
    const res = await rpc('home.lvh.me', 'auth.signup', [
      { email: 'notgrace@example.com', password: 'hunter2secret', token: invite.json.result.token },
    ])
    assert.equal(res.status, 200)
    assert.equal(res.json.result.role, 'member')
  })

  it('re-inviting an email rotates its token', async () => {
    const first = await rpc('home.lvh.me', 'auth.invite', [{ email: 'hank@example.com' }], { cookie: adminCookie })
    const second = await rpc('home.lvh.me', 'auth.invite', [{ email: 'hank@example.com' }], { cookie: adminCookie })
    assert.notEqual(first.json.result.token, second.json.result.token)

    // the first link is dead
    const old = await rpc('home.lvh.me', 'auth.signup', [
      { email: 'hank@example.com', password: 'hunter2secret', token: first.json.result.token },
    ])
    assert.equal(old.status, 403)
    await sleep(2)
  })

  it('listMembers hides invite tokens from non-admins', async () => {
    const memberLogin = await rpc('home.lvh.me', 'auth.login', [{ email: 'bob@example.com', password: 'hunter2secret' }])
    const res = await rpc('home.lvh.me', 'listMembers', [], { cookie: cookieFrom(memberLogin.setCookie) })
    assert.equal(res.status, 200)
    assert.ok(res.json.result.invites.length > 0)
    for (const inv of res.json.result.invites) assert.ok(!('token' in inv))
  })
})

/* ---------------- password reset ---------------- */

describe('password reset', () => {
  let adminCookie
  let memberCookie

  before(async () => {
    const admin = await rpc('home.lvh.me', 'auth.login', [{ email: 'jane@example.com', password: 'hunter2secret' }])
    adminCookie = cookieFrom(admin.setCookie)
    const member = await rpc('home.lvh.me', 'auth.login', [{ email: 'bob@example.com', password: 'hunter2secret' }])
    memberCookie = cookieFrom(member.setCookie)
  })

  let token

  it('admin generates a reset link for a member', async () => {
    const bob = platform.prepare('SELECT id FROM users WHERE email = ?').get('bob@example.com')
    const res = await rpc('home.lvh.me', 'auth.resetPasswordLink', [{ userId: bob.id }], { cookie: adminCookie })
    assert.equal(res.status, 200)
    assert.equal(res.json.result.email, 'bob@example.com')
    assert.ok(res.json.result.token, 'returns a reset token')
    token = res.json.result.token
  })

  it('auth.resetPasswordInfo resolves a valid token', async () => {
    const res = await rpc('home.lvh.me', 'auth.resetPasswordInfo', [{ token }])
    assert.equal(res.status, 200)
    assert.equal(res.json.result.valid, true)
    assert.equal(res.json.result.email, 'bob@example.com')
  })

  it('auth.resetPasswordInfo rejects unknown tokens', async () => {
    const res = await rpc('home.lvh.me', 'auth.resetPasswordInfo', [{ token: 'not-a-real-token' }])
    assert.equal(res.status, 200)
    assert.equal(res.json.result.valid, false)
  })

  it('only admins can generate reset links', async () => {
    const bob = platform.prepare('SELECT id FROM users WHERE email = ?').get('bob@example.com')
    const res = await rpc('home.lvh.me', 'auth.resetPasswordLink', [{ userId: bob.id }], { cookie: memberCookie })
    assert.equal(res.status, 403)
    assert.equal(res.json.error.code, 'FORBIDDEN')
  })

  it('cannot generate a reset link for a user outside the family', async () => {
    const carol = platform.prepare('SELECT id FROM users WHERE email = ?').get('carol@example.com')
    const res = await rpc('home.lvh.me', 'auth.resetPasswordLink', [{ userId: carol.id }], { cookie: adminCookie })
    assert.equal(res.status, 404)
    assert.equal(res.json.error.code, 'NOT_FOUND')
  })

  it('rejects a short new password', async () => {
    const res = await rpc('home.lvh.me', 'auth.resetPassword', [{ token, password: 'short' }])
    assert.equal(res.status, 400)
    assert.equal(res.json.error.code, 'INVALID_ARGS')
  })

  it('resets the password, consumes the token, and kills old sessions', async () => {
    const res = await rpc('home.lvh.me', 'auth.resetPassword', [{ token, password: 'brandnewsecret' }])
    assert.equal(res.status, 200)
    assert.equal(res.json.result.ok, true)

    // the old password no longer works
    const oldLogin = await rpc('home.lvh.me', 'auth.login', [{ email: 'bob@example.com', password: 'hunter2secret' }])
    assert.equal(oldLogin.status, 401)
    await sleep(2)

    // the new password works
    const newLogin = await rpc('home.lvh.me', 'auth.login', [{ email: 'bob@example.com', password: 'brandnewsecret' }])
    assert.equal(newLogin.status, 200)

    // the member's pre-reset session was invalidated
    const meta = await rpc('home.lvh.me', 'meta', [], { cookie: memberCookie })
    assert.equal(meta.json.result.user, null)

    // the token is single-use
    const again = await rpc('home.lvh.me', 'auth.resetPassword', [{ token, password: 'anothersecret' }])
    assert.equal(again.status, 403)
    assert.equal(again.json.error.code, 'FORBIDDEN')
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
