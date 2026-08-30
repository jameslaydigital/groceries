# 🥬 Groceries

A visually stunning, mobile-first grocery list PWA. Built with **Svelte 5 + Vite** on the front and **Node + SQLite (`node:sqlite`)** on the back, communicating over a thin JSON-RPC layer.

## Run it

```bash
npm install
npm run dev          # Vite dev server on :5173, proxies /rpc to the backend
npm run build        # production build into dist/
npm start            # serves dist/ + the RPC API on :8787
```

The server is multi-tenant. Each **family** gets its own SQLite file (`families/<subdomain>.db`) and you pick which family you're looking at by subdomain:

```bash
npm start
# then visit http://localhost:8787           → default family ("home")
#      or http://home.lvh.me:8787            → same default family
npm run family -- create james "James Family"
# then visit http://james.lvh.me:8787        → the new family's list
```

`lvh.me` resolves every subdomain to `127.0.0.1`, so this works locally with zero DNS setup. Global data (users, families, sessions) lives in `platform.db`; per-family data lives in `families/*.db`. If a legacy single-tenant `groceries.db` exists on first run, it's adopted as the `home` family's database.

## The RPC layer

The front and back end talk only through an RPC endpoint — `POST /rpc` with `{ "method": "...", "params": [...] }`, returning `{ ok: true, result }` or `{ ok: false, error }`.

On the client it's exactly the shape you asked for:

```js
const items = await rpc('listItems')
const saved = await rpc('addItem', { name: 'Avocados', quantity: '2', category: 'Produce' })
await rpc('setChecked', id, true)
```

- **Client:** `src/lib/rpc.js` — `rpc(method, ...params)`, plus an offline queue (mutations are persisted in `localStorage` and replayed when back online).
- **Server:** `server.js` — the method dispatcher (`methods` map) backed by SQLite. Each request resolves its family from the `Host` header, opens that family's tenant database, and passes a `ctx = { db, family, user, families }` to the handler.

### Methods

| Method          | Params                                 | Returns                              |
| --------------- | -------------------------------------- | ------------------------------------ |
| `meta`          | —                                      | `{ family, user, families }`         |
| `ping`          | —                                      | `{ pong }`                           |
| `snapshot`      | —                                      | `{ categories, items }`              |
| `listCategories`| —                                      | categories with item counts          |
| `listItems`     | —                                      | sorted items joined with icons       |
| `addItem`       | `{ name, quantity, category }`         | saved item                           |
| `updateItem`    | `id, { name?, quantity?, category?, checked? }` | saved item                  |
| `setChecked`    | `id, checked`                          | saved item                           |
| `deleteItem`    | `id`                                   | `{ id }`                             |
| `clearChecked`  | —                                      | `{ removed }`                        |
| `suggestions`   | `prefix, limit?`                       | matching item names + categories     |

## PWA features

- Installable (`manifest.webmanifest`, generated icons via `npm run icons`)
- Offline-first: app shell + assets cached by a service worker, list state persisted locally, mutations queued and synced on reconnect
- Cache-busted every build: the SW cache name is versioned per build, and `sw.js`/`index.html`/manifest are served `no-cache`

## Layout

```
server.js                  Node + node:sqlite HTTP server, platform DB + tenant resolver, RPC dispatcher
scripts/create-family.mjs  CLI to provision a new family (npm run family)
src/lib/rpc.js             rpc() client + offline queue
src/lib/store.svelte.js    Svelte 5 runes store, optimistic updates, local persistence
src/App.svelte             shell: header + progress ring, search, category chips, list, FAB
src/components/            ItemRow (swipe-to-delete), AddSheet (bottom sheet), ProgressRing
public/manifest.webmanifest, public/sw.js, scripts/gen-icons.mjs
```

## Tests

```bash
npm test
```

Runs the `node:test` suite (no deps). `test/tenant.test.mjs` locks down the tenant-selection security boundary: Host-header parsing (case, ports, IPv6, trailing dots, crafted aliases), unknown/empty/missing hosts, tenant data isolation, and hostile Host headers that must never create files outside `families/` or leave a request hanging.

## Notes

- Defaults to port **8787** (`PORT=...` to override) because 3000 was taken on this machine; update `vite.config.js` if you change it.
- Icons are drawn programmatically (pure-Node PNG encoder) — tweak `scripts/gen-icons.mjs` and re-run `npm run icons`.
