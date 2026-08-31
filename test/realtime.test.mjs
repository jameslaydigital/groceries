import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DATA_DIR = mkdtempSync(join(tmpdir(), 'groceries-realtime-test-'))
process.env.DATA_DIR = DATA_DIR
process.env.PLATFORM_DB = join(DATA_DIR, 'platform.db')
process.env.SKIP_LEGACY_ADOPTION = '1'

const { createApp, platform } = await import('../server.js')

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

function openSSE(host, cookie) {
  return new Promise((resolve, reject) => {
    const headers = host ? { Host: host } : {}
    if (cookie) headers.Cookie = cookie
    const req = http.request({ host: '127.0.0.1', port, path: '/events', method: 'GET', headers }, (res) => {
      let buf = ''
      const frames = []
      const waiters = []
      const dispatch = (frame) => {
        for (const w of [...waiters]) {
          if (w.re.test(frame)) {
            waiters.splice(waiters.indexOf(w), 1)
            w.resolve(frame)
          }
        }
      }
      res.on('data', (c) => {
        buf += c
        let idx
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          frames.push(frame)
          dispatch(frame)
        }
      })
      resolve({
        status: res.statusCode,
        frames: () => [...frames],
        waitFor: (re, timeout = 4000) =>
          new Promise((r, j) => {
            if (frames.some((f) => re.test(f))) return r()
            const w = { re, resolve: r }
            waiters.push(w)
            setTimeout(() => {
              const i = waiters.indexOf(w)
              if (i >= 0) waiters.splice(i, 1)
              j(new Error(`timed out waiting for ${re} — frames: ${frames.join(' | ')}`))
            }, timeout)
          }),
        close: () => req.destroy(),
      })
    })
    req.on('error', reject)
    req.end()
  })
}

async function signup(host, email, password, token) {
  const res = await rpc(host, 'auth.signup', [{ email, password, name: 'T', ...(token ? { token } : {}) }])
  return cookieFrom(res.setCookie)
}

/* ---------------- tests ---------------- */

describe('SSE endpoint', () => {
  it('rejects unauthenticated connections', async () => {
    const sse = await openSSE('home.lvh.me')
    assert.equal(sse.status, 401)
    sse.close()
  })

  it('greets an authenticated member with a hello frame', async () => {
    const cookie = await signup('home.lvh.me', 'a@example.com', 'hunter2secret')
    const sse = await openSSE('home.lvh.me', cookie)
    assert.equal(sse.status, 200)
    await sse.waitFor(/event: hello/)
    sse.close()
  })
})

describe('realtime broadcast', () => {
  it('pushes a snapshot to other members after a mutation', async () => {
    // admin + invited member on the same family
    const adminCookie = await signup('home.lvh.me', 'a@example.com', 'hunter2secret')
    const invite = await rpc('home.lvh.me', 'auth.invite', [{ email: 'b@example.com' }], { cookie: adminCookie })
    const memberCookie = await signup('home.lvh.me', 'b@example.com', 'hunter2secret', invite.json.result.token)

    const sse = await openSSE('home.lvh.me', memberCookie)
    await sse.waitFor(/event: hello/)

    // admin adds an item — the member's stream should see it immediately
    await rpc('home.lvh.me', 'addItem', [{ name: 'Live Tomatoes', quantity: '2', category: 'Produce' }], { cookie: adminCookie })

    await sse.waitFor(/Live Tomatoes/)
    const frame = sse.frames().find((f) => f.includes('Live Tomatoes'))
    assert.match(frame, /event: snapshot/)
    assert.match(frame, /"name":"Live Tomatoes"/)
    sse.close()
  })

  it('does not leak snapshots across families', async () => {
    // a@example.com is already the home admin (re-signup logs back in)
    const adminCookie = await signup('home.lvh.me', 'a@example.com', 'hunter2secret')
    const invite = await rpc('home.lvh.me', 'auth.invite', [{ email: 'c@example.com' }], { cookie: adminCookie })
    const carolCookie = await signup('home.lvh.me', 'c@example.com', 'hunter2secret', invite.json.result.token)

    const sse = await openSSE('home.lvh.me', carolCookie)
    await sse.waitFor(/event: hello/)

    // dave has his own family
    const other = platform.prepare('INSERT INTO families (subdomain, name) VALUES (?, ?)').run('dave', 'Dave Family')
    void other
    const daveCookie = await signup('dave.lvh.me', 'd@example.com', 'hunter2secret')

    // dave adds to his own family — carol's stream must not see it
    await rpc('dave.lvh.me', 'addItem', [{ name: 'DavesPrivateCheese', quantity: '1', category: 'Dairy' }], { cookie: daveCookie })
    await new Promise((r) => setTimeout(r, 600))
    assert.ok(!sse.frames().some((f) => f.includes('DavesPrivateCheese')), 'cross-family frame leaked')
    sse.close()
  })
})
