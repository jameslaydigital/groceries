# AGENTS.md

Context for AI agents and contributors working in this repo. Read before
editing. Deeper product history is in `ROADMAP.md`; live-host details are in
`deploy/README.md`.

## What this is

**Syncart** — a family grocery list PWA. Svelte 5 + Vite frontend, Node
(`node:sqlite`, zero runtime npm deps) backend, communicating over a thin
JSON-RPC layer. Offline-capable, installable, realtime-synced between family
members, multi-tenant (one family per subdomain), tagged by store (Costco /
Trader Joe's / Smith's).

## Commands

```bash
npm run dev:all          # backend (:8787) + Vite dev server (:5173) together
npm run dev              # Vite only (expects a backend on :8787)
npm run build            # prod build into dist/
npm start                # serve dist/ + API on :8787
npm test                 # node:test suite (unit + integration)
npm run setup            # idempotent: home family + dev@example.com/devpassword + seed
npm run user -- create <family> <email> <pw> [--name ".."] [--member]
npm run seed -- <family> [--clear]
npm run family -- create <subdomain> "<Name>"
npm run backup           # VACUUM INTO snapshots of platform.db + every family DB
```

Dev URLs: `http://localhost:5173` (Vite) or `http://localhost:8787` (prod-style).
Subdomains via `lvh.me` → e.g. `http://james.lvh.me:5173`.

## Architecture

- **`server.js`** — the whole backend (HTTP + RPC + SSE).
  - **Two DB tiers:** `platform.db` (users, families, memberships, sessions,
    invites) and per-family tenant DBs at `families/<subdomain>.db`
    (categories, items, tags, item_tags). Migrations via `PRAGMA user_version`.
  - **Tenant resolution:** `tenantKeyFromHost()` reads the `Host` header.
    The tenant key is simply the **leftmost label** of the host (base-domain
    agnostic — any `*.yourdomain` resolves the same family). `localhost`/
    loopback and `DEFAULT_HOSTS` env (bare IPs before DNS is wired) map to the
    default family. Unknown hosts → `NO_FAMILY`. `buildCtx(req)` →
    `{ db, family, user, role, families, bootstrap }`.
  - **RPC:** `POST /rpc` with `{ method, params }` → `{ ok, result }` /
    `{ ok, error }`. Dispatcher is the `methods` map; handlers get `ctx`.
    `PUBLIC_METHODS` (ping/meta/auth.*) are unauthenticated; everything else
    needs a session + membership in the current family (bootstrap families are
    open until the first member signs up).
  - **Auth:** scrypt password hashes, httpOnly cookie (`groceries.session`),
    per-second rate limit on failed attempts (per IP + per email), cleared on
    success. First user of an empty family becomes admin; everyone else joins
    via a one-time invite link (`/invite/accept/<token>`, 256-bit token,
    single-use, revocable; re-inviting an email rotates the token).
  - **Realtime:** `GET /events` (SSE), authenticated, per-family in-memory
    broadcast set. After any mutation, the server pushes the fresh snapshot to
    that family's connected clients.
  - **Env:** `PORT`, `BIND_HOST` (default `127.0.0.1` — app should sit behind a
    proxy), `DEFAULT_HOSTS`, `COOKIE_DOMAIN`, `COOKIE_SECURE`,
    `DEFAULT_SUBDOMAIN` (default `home`), `AUTH_RATE_MS`, `DATA_DIR`,
    `PLATFORM_DB`.
- **`src/lib/rpc.js`** — client `rpc(method, ...params)`; throws `RpcError`
  with `.code` (`OFFLINE`, `AUTH_REQUIRED`, `FORBIDDEN`, …). Offline mutations
  are queued in localStorage and replayed on `online`.
- **`src/lib/store.svelte.js`** — Svelte 5 runes store. Local-first: persists
  state, reconciles with server snapshots. Export: `data`, `family`, `user`,
  `auth`, `ui`, `load`, `login`, `signup`, `logout`, `invite`, `refresh`, etc.
- **`src/lib/realtime.js`** — `EventSource('/events')` → feeds `refresh()`.
- **Components:** `App.svelte` (shell), `AuthScreen.svelte`, `AddSheet.svelte`,
  `ItemRow.svelte` (swipe-to-delete), `ProgressRing.svelte`.

## Critical invariants & gotchas

- **Do NOT rename the internal `groceries.*` identifiers:** cookie name
  `groceries.session`, localStorage keys `groceries.state.v1`, `groceries.auth`,
  `groceries.pending.v1`, and the SW cache prefix `groceries-…`. They're baked
  into existing sessions/caches; renaming logs everyone out and orphans data.
- **SSE breaks `waitUntil: 'networkidle'`** — an always-open `/events` stream
  means Playwright `networkidle` never settles. Use `'domcontentloaded'`.
- **Optimistic adds + live snapshots can duplicate item ids.** The store's
  `refresh()` and `addItem()` must stay idempotent (match pending temp rows by
  `name|category|quantity`, remove pending, only add a server item if its id
  isn't already present). This was a real `each_key_duplicate` crash (Svelte
  keyed `each`) — don't regress it.
- **Single process only.** SSE broadcast is in-memory; don't scale the app to
  multiple replicas without adding pub/sub.
- **The welcome toast floats over the sheet's submit/FAB briefly** — `openAdd()`
  clears `ui.toast` first. Tests that tap the FAB or submit right after a
  login/signup should wait for the sheet to settle or use coordinate/force clicks.
- **Svelte 5:** you can't export a `$state` binding that gets reassigned
  (compile error `state_invalid_export`). Wrap reassigned state in an object
  (e.g., `auth.status`, not `let authStatus`). Runes only in `.svelte`/`.svelte.js`.
- **`node:sqlite` requires Node ≥ 22.** The runtime has zero npm dependencies
  (`node:sqlite` is built in), so a production image/deploy needs no `node_modules`.
- **Tests are env-isolated:** each `test/*.test.mjs` sets temp `DATA_DIR` /
  `PLATFORM_DB` (and often `AUTH_RATE_MS`) before importing `server.js`. New
  tests should do the same and must not assume a shared/claimed family — sign
  up users (bootstrap) or insert members directly via the exported `platform`.
- The Playwright browser tests live under `/tmp/opencode/pwtest` (scratch, not
  committed). `helpers.mjs` there has `authenticate(ctx, base)` and `clickFab(page)`.

## Conventions

- No framework/server deps by design — prefer Node built-ins (`node:sqlite`,
  `node:test`, `node:crypto`).
- Follow the existing RPC shape; don't introduce REST endpoints for data.
- Keep handlers as `methods[method](ctx, ...params)`.
- UI is mobile-first; reuse the CSS variables in `src/app.css` (light + dark).
