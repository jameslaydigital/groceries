import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* Isolate the server's storage from the real app before importing it. */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'groceries-tenant-test-'))
process.env.DATA_DIR = DATA_DIR
process.env.PLATFORM_DB = join(DATA_DIR, 'platform.db')
process.env.SKIP_LEGACY_ADOPTION = '1'
process.env.DEFAULT_HOSTS = '10.0.0.9,203.0.113.7'

const {
  tenantKeyFromHost,
  buildCtx,
  getTenantDb,
  createApp,
  DEFAULT_SUBDOMAIN,
  TenantError,
} = await import('../server.js')

let server
let port

before(async () => {
  // add a second family alongside the auto-seeded default
  const { DatabaseSync } = await import('node:sqlite')
  const platform = new DatabaseSync(join(DATA_DIR, 'platform.db'))
  platform.prepare('INSERT INTO families (subdomain, name) VALUES (?, ?)').run('james', 'James Family')
  platform.close()

  server = createApp()
  await new Promise((resolve) => server.listen(0, resolve))
  port = server.address().port
})

after(() => {
  server?.close()
  rmSync(DATA_DIR, { recursive: true, force: true })
})

/* ---------------- helpers ---------------- */

function rpc(hostHeader, method, params = []) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ method, params })
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/rpc',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(hostHeader !== undefined ? { Host: hostHeader } : {}),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          let json = null
          try {
            json = JSON.parse(data)
          } catch {
            /* non-JSON */
          }
          resolve({ status: res.statusCode, json })
        })
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

function raw(hostHeader) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1')
    let data = ''
    sock.on('data', (c) => (data += c))
    sock.on('error', reject)
    sock.on('close', () => resolve(data))
    const body = JSON.stringify({ method: 'meta', params: [] })
    const hostLine = hostHeader !== undefined ? `Host: ${hostHeader}\r\n` : ''
    sock.write(
      `POST /rpc HTTP/1.1\r\n${hostLine}Content-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
    )
  })
}

const filesInDataDir = () => readdirSync(DATA_DIR).filter((f) => !f.includes('platform')).sort()

/* ---------------- unit: tenant key extraction ---------------- */

describe('tenantKeyFromHost', () => {
  it('extracts the subdomain from a subdomain.lvh.me host', () => {
    assert.equal(tenantKeyFromHost('james.lvh.me:8787'), 'james')
    assert.equal(tenantKeyFromHost('james.lvh.me'), 'james')
    assert.equal(tenantKeyFromHost('home.lvh.me'), 'home')
  })

  it('is case-insensitive', () => {
    assert.equal(tenantKeyFromHost('JAMES.lvh.ME:8787'), 'james')
    assert.equal(tenantKeyFromHost('JaMeS.lvh.me'), 'james')
  })

  it('maps localhost / loopback / bare IPs to the default tenant', () => {
    assert.equal(tenantKeyFromHost('localhost:8787'), DEFAULT_SUBDOMAIN)
    assert.equal(tenantKeyFromHost('localhost'), DEFAULT_SUBDOMAIN)
    assert.equal(tenantKeyFromHost('127.0.0.1:8787'), DEFAULT_SUBDOMAIN)
    assert.equal(tenantKeyFromHost('127.0.0.1'), DEFAULT_SUBDOMAIN)
  })

  it('maps explicitly configured DEFAULT_HOSTS to the default tenant', () => {
    assert.equal(tenantKeyFromHost('10.0.0.9'), DEFAULT_SUBDOMAIN)
    assert.equal(tenantKeyFromHost('10.0.0.9:8787'), DEFAULT_SUBDOMAIN)
    assert.equal(tenantKeyFromHost('203.0.113.7'), DEFAULT_SUBDOMAIN)
    // unlisted hosts are not silently mapped
    assert.notEqual(tenantKeyFromHost('198.51.100.55'), DEFAULT_SUBDOMAIN)
  })

  it('uses the leftmost label as the tenant, regardless of base domain', () => {
    assert.equal(tenantKeyFromHost('home.example.com'), DEFAULT_SUBDOMAIN)
    assert.equal(tenantKeyFromHost('james.example.com'), 'james')
    assert.equal(tenantKeyFromHost('home.progressive-apps.com'), DEFAULT_SUBDOMAIN)
    assert.equal(tenantKeyFromHost('james.progressive-apps.com'), 'james')
    assert.equal(tenantKeyFromHost('home.lvh.me'), DEFAULT_SUBDOMAIN)
    assert.equal(tenantKeyFromHost('james.lvh.me'), 'james')
    // the apex has no subdomain — its leftmost label is the whole domain
    assert.equal(tenantKeyFromHost('progressive-apps.com'), 'progressive-apps')
    // the base domain is not required to be known or configured
    assert.equal(tenantKeyFromHost('james.any-other-domain.net'), 'james')
  })

  it('maps IPv6 loopback literals to the default tenant', () => {
    assert.equal(tenantKeyFromHost('[::1]:8787'), DEFAULT_SUBDOMAIN)
    assert.equal(tenantKeyFromHost('[::1]'), DEFAULT_SUBDOMAIN)
    assert.equal(tenantKeyFromHost('[fe80::1]'), DEFAULT_SUBDOMAIN)
  })

  it('ignores arbitrary ports', () => {
    assert.equal(tenantKeyFromHost('james.lvh.me:99999'), 'james')
    assert.equal(tenantKeyFromHost('james.lvh.me:80'), 'james')
  })

  it('ignores everything after the leftmost label', () => {
    // the tenant is decided by the first label alone, so suffix/prefix tricks
    // resolve by that label — access is still gated by session + membership
    assert.equal(tenantKeyFromHost('james.lvh.me.evil.com'), 'james')
    assert.equal(tenantKeyFromHost('eviljames.lvh.me'), 'eviljames')
    assert.equal(tenantKeyFromHost('a.b.lvh.me'), 'a')
    assert.equal(tenantKeyFromHost('lvh.me'), 'lvh')
  })

  it('sanitizes hostile input into harmless or rejected keys', () => {
    // path-ish input: the leftmost label is empty/garbage → rejected as null
    assert.equal(tenantKeyFromHost('../etc/passwd'), null)
    assert.equal(tenantKeyFromHost('..'), null)
    assert.equal(tenantKeyFromHost('a/b'), 'a-b')
    assert.equal(tenantKeyFromHost('hello world'), 'hello-world')
    // no dots → the whole (sanitized) string is the label; getTenantDb rejects
    // keys that don't match the subdomain whitelist (e.g. leading '-')
    assert.equal(tenantKeyFromHost('/etc/passwd'), '-etc-passwd')
  })

  it('returns null for empty / missing hosts', () => {
    assert.equal(tenantKeyFromHost(''), null)
    assert.equal(tenantKeyFromHost('   '), null)
    assert.equal(tenantKeyFromHost(null), null)
    assert.equal(tenantKeyFromHost(undefined), null)
  })
})

/* ---------------- unit: tenant db path safety ---------------- */

describe('getTenantDb', () => {
  it('rejects any key that could escape the data dir', () => {
    for (const bad of ['..', '../etc', 'a/b', 'A', 'UPPER', 'a.b', 'home..db', '']) {
      assert.throws(() => getTenantDb(bad), TenantError)
    }
  })
})

/* ---------------- integration: selection over HTTP ---------------- */

describe('tenant selection over HTTP', () => {
  it('routes each Host to its own family', async () => {
    const home = await rpc('home.lvh.me:8787', 'meta')
    const james = await rpc('james.lvh.me', 'meta')
    assert.equal(home.status, 200)
    assert.equal(home.json.result.family.subdomain, 'home')
    assert.equal(james.json.result.family.subdomain, 'james')
    assert.equal(james.json.result.family.name, 'James Family')
  })

  it('treats localhost as the default family', async () => {
    const res = await rpc('localhost:8787', 'meta')
    assert.equal(res.status, 200)
    assert.equal(res.json.result.family.subdomain, DEFAULT_SUBDOMAIN)
  })

  it('handles case-insensitive Host headers', async () => {
    const res = await raw('JAMES.lvh.ME:8787')
    assert.match(res, /200 OK/)
  })

  it('rejects unknown subdomains with NO_FAMILY', async () => {
    for (const host of ['nope.lvh.me', 'missing.progressive-apps.com', 'a.b.lvh.me']) {
      const res = await rpc(host, 'meta')
      assert.equal(res.status, 404, `expected 404 for Host ${host}`)
      assert.equal(res.json.ok, false)
      assert.equal(res.json.error.code, 'NO_FAMILY')
    }
  })

  it('resolves the same family on any base domain', async () => {
    const res = await rpc('james.progressive-apps.com', 'meta')
    assert.equal(res.status, 200)
    assert.equal(res.json.result.family.subdomain, 'james')
    assert.equal(res.json.result.family.name, 'James Family')
  })

  it('rejects a request with no Host header', async () => {
    // Node itself rejects HTTP/1.1 without a Host header (400) before our
    // handler runs — never a tenant response, which is what we care about.
    const res = await raw(undefined)
    assert.match(res, /400 Bad Request/)
    assert.doesNotMatch(res, /200 OK/)
  })

  it('rejects a request with an empty Host header', async () => {
    const res = await raw('   ')
    assert.match(res, /404 Not Found/)
  })
})

/* ---------------- integration: data isolation ---------------- */

describe('tenant data isolation', () => {
  it('keeps each family’s items in separate databases', async () => {
    const added = await rpc('james.lvh.me', 'addItem', [{ name: 'Secret Snack', quantity: '1', category: 'Snacks' }])
    assert.equal(added.json.ok, true)

    const jamesItems = await rpc('james.lvh.me', 'listItems')
    const homeItems = await rpc('home.lvh.me', 'listItems')

    assert.equal(jamesItems.json.result.some((i) => i.name === 'Secret Snack'), true)
    assert.equal(homeItems.json.result.some((i) => i.name === 'Secret Snack'), false)

    // physically separate files
    const files = filesInDataDir()
    assert.ok(files.includes('home.db'), `home.db present in ${files.join(',')}`)
    assert.ok(files.includes('james.db'), `james.db present in ${files.join(',')}`)
  })

  it('does not leak one tenant into another via Host spoofing', async () => {
    const spoofed = await rpc('home.lvh.me', 'snapshot')
    assert.equal(spoofed.json.result.items.some((i) => i.name === 'Secret Snack'), false)
  })
})

/* ---------------- integration: hostile hosts cannot escape the data dir ---------------- */

describe('hostile Host headers', () => {
  it('never creates files outside the tenant data dir', async () => {
    const hostile = [
      '../../../../etc/passwd', // → null → NO_FAMILY
      '/etc/passwd', // → '-etc-passwd' → invalid key → NO_FAMILY
      '..', // → null → NO_FAMILY
      'a/b', // → 'a-b' → invalid key → NO_FAMILY
      'hello world', // → 'hello-world' → no such family → NO_FAMILY
      'eviljames.lvh.me', // → 'eviljames' → no such family → NO_FAMILY
      'a.b.lvh.me', // → 'a' → no such family → NO_FAMILY
      'missing.progressive-apps.com', // → 'missing' → no such family → NO_FAMILY
    ]
    for (const host of hostile) {
      // some hosts trip the HTTP client's own header validation; a client-side
      // rejection is fine — the attack never reached the server.
      const res = await rpc(host, 'snapshot').catch(() => null)
      if (res) assert.equal(res.status, 404, `Host ${JSON.stringify(host)} should be 404`)
    }
    // Hosts whose leftmost label IS an existing family (e.g. james.lvh.me.evil.com)
    // are intentionally accepted under the leftmost-label model — they reuse the
    // existing family db, and access is gated by session + membership.
    const files = filesInDataDir()
    const dbs = files.filter((f) => f.endsWith('.db'))
    assert.deepEqual(dbs.sort(), ['home.db', 'james.db'])
  })
})

/* ---------------- integration: buildCtx contract ---------------- */

describe('buildCtx', () => {
  it('returns a per-family db and family, with no auth yet', () => {
    const ctx = buildCtx({ headers: { host: 'james.lvh.me' } })
    assert.equal(ctx.family.subdomain, 'james')
    assert.equal(ctx.user, null)
    assert.deepEqual(ctx.families, [])
    assert.equal(ctx.bootstrap, true)
    // ctx.db really is the tenant db
    const items = ctx.db.prepare('SELECT COUNT(*) AS n FROM items').get()
    assert.equal(typeof items.n, 'number')
  })

  it('throws NO_FAMILY for unknown tenants', () => {
    assert.throws(() => buildCtx({ headers: { host: 'missing.lvh.me' } }), (e) => e.code === 'NO_FAMILY')
    assert.throws(() => buildCtx(null), (e) => e.code === 'NO_FAMILY')
  })
})
