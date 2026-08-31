# 🧺 Syncart

A visually stunning, mobile-first grocery list PWA for families. Built with **Svelte 5 + Vite** on the front and **Node + SQLite (`node:sqlite`)** on the back, communicating over a thin JSON-RPC layer. Changes sync instantly between devices over SSE.

> Context: agents/contributors should read **`AGENTS.md`** (architecture, invariants, gotchas) before editing. Live-host and deployment details are in **`deploy/README.md`**. Product history is in **`ROADMAP.md`**.

## Run it

```bash
npm install
npm run dev:all     # backend on :8787 + Vite dev server on :5173 (hot reload)
npm run dev         # Vite only on :5173 (expects a backend already on :8787)
npm run build       # production build into dist/
npm start           # serves dist/ + the RPC API on :8787
npm run backup      # snapshot platform.db + every family DB into backups/
```

Two ports to know:
- **:5173** — the Vite dev server you browse during development (`http://localhost:5173`). It proxies `/rpc` and `/events` to the backend, so the backend must also be running (`dev:all` starts both).
- **:8787** — the production-style server (`npm start`): serves the built app **and** the API. Both share the same test login; cookies and the realtime SSE stream work through either.

The server is multi-tenant. Each **family** gets its own SQLite file (`families/<subdomain>.db`) and you pick which family you're looking at by subdomain:

```bash
npm start
# then visit http://localhost:8787           → default family ("home")
#      or http://home.lvh.me:8787            → same default family
npm run family -- create james "James Family"
# then visit http://james.lvh.me:8787        → the new family's list
```

`lvh.me` resolves every subdomain to `127.0.0.1`, so this works locally with zero DNS setup. Global data (users, families, sessions) lives in `platform.db`; per-family data lives in `families/*.db`. If a legacy single-tenant `groceries.db` exists on first run, it's adopted as the `home` family's database.

### Dev accounts & seed data

```bash
npm run setup           # one-shot: ensures the home family, creates a known
                        # test login (dev@example.com / devpassword), seeds data
npm run user -- create home bob@example.com bobpassword --name "Bob"
npm run seed -- home            # drop 28 realistic items into the home family
npm run seed -- home --clear    # clear the family's items first, then seed
```

`npm run setup` is idempotent — safe to re-run any time (it resets the dev password and only seeds when the family is empty). `npm run user -- create <family> <email> <password> [--name "..."] [--member]` provisions a known account for any family, even ones already claimed. The first visitor to an empty family can also just sign up and becomes admin automatically.

`npm run seed -- <family> [--clear]` fills a family with sample groceries across categories, tagged with stores (Costco / Trader Joe's / Smith's) and a few already checked off — handy for seeing the whole UI populated.

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
- **Realtime:** after every successful mutation the server broadcasts the fresh snapshot over **SSE** (`/events`) to that family's connected clients; `src/lib/realtime.js` pipes those frames straight into the store, so changes on one device appear instantly on others.
- **Store tags:** items are tagged with stores (Costco / Trader Joe's / Smith's, plus custom tags) via a `tags` + `item_tags` join. Tag chips in the add sheet, a tag filter row, and per-item store badges make "shopping at Costco" a single tap.

### Methods

| Method          | Params                                 | Returns                              |
| --------------- | -------------------------------------- | ------------------------------------ |
| `meta`          | —                                      | `{ family, user, role, families }`   |
| `auth.signup`   | `{ email, password, name?, token? }`   | auth result + session cookie; `token` (invite link) required for private families |
| `auth.login`    | `{ email, password }`                  | auth result + session cookie         |
| `auth.logout`   | —                                      | clears the session cookie            |
| `auth.invite`   | `{ email }`                            | admin-only; returns a one-time invite `token` |
| `auth.inviteInfo`| `{ token }`                           | public; validates an invite link, returns `{ valid, family, email }` |
| `revokeInvite`  | `{ id }`                               | admin-only, cancels a pending invite |
| `auth.resetPasswordLink` | `{ userId }`                 | admin-only, mints a one-time password-reset link (24h) |
| `auth.resetPasswordInfo` | `{ token }`                  | public; validates a reset link, returns `{ valid, email }` |
| `auth.resetPassword` | `{ token, password }`            | public; sets a new password and kills old sessions |
| `listMembers`   | —                                      | `{ members, invites }` for this family |
| `listTags`      | —                                      | all tags for this family             |
| `addTag`        | `{ name, icon? }`                      | the created tag                      |
| `setItemTags`   | `id, tagIds`                           | item with updated `tag_ids`          |
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

Runs the `node:test` suite (no deps).
- `test/tenant.test.mjs` locks down the tenant-selection security boundary: Host-header parsing (case, ports, IPv6, trailing dots, crafted aliases), unknown/empty/missing hosts, tenant data isolation, and hostile Host headers that must never create files outside `families/` or leave a request hanging.
- `test/auth.test.mjs` covers the auth flow: bootstrap mode, first-user-becomes-admin, scrypt hashing, token-based invite signup (`/invite/accept/<token>`), admin-only invites, login/logout, session cookies, and the 401/403 guards.
- `test/realtime.test.mjs` covers SSE: auth guard on the stream, snapshot broadcasts to other members, and cross-family isolation (no leak between tenants).
- `test/tags.test.mjs` covers store tagging: seeded tags, tagging items on create/update, custom tags, and snapshot shape.
- `test/hardening.test.mjs` covers brute-force rate limiting (at most one failed attempt per second, per IP and per email, cleared on success), hashed session-token storage, and expired-session rejection.

## Notes

- Defaults to port **8787** (`PORT=...` to override) because 3000 was taken on this machine; update `vite.config.js` if you change it.
- Icons are drawn programmatically (pure-Node PNG encoder) — tweak `scripts/gen-icons.mjs` and re-run `npm run icons`.
