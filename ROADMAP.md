# Roadmap

A grocery list PWA for a family. Mobile-first, offline-capable, installable. Backend is Node + `node:sqlite`; frontend is Svelte 5 + Vite; the two communicate over a JSON-RPC layer (`rpc('method', ...args)`).

**North star:** two people in different rooms, same list — one checks off avocados, the other's phone updates instantly, and both can shop at whichever store the item lives at.

---

## Phase 0 — Multi-tenancy foundation ✅ done

The current `server.js` opened a single `groceries.db` at startup and every RPC handler used a global `db`. Now it's multi-tenant.

**Two databases:**
- **`platform.db`** (global): `users`, `families`, `memberships`, `sessions`
- **`families/<subdomain>.db`** (per tenant): categories, items, tags, item_tags

**Tenant resolution:**
- Read `Host` header (`james.lvh.me:8787` → subdomain `james`). lvh.me resolves every subdomain to `127.0.0.1` for local dev.
- Look up the family in `platform.db`; lazily open (and cache) that family's sqlite file.
- Migrations per tenant DB tracked via `PRAGMA user_version`.
- Vite's dev proxy preserves the original `Host` header, so `james.lvh.me:5173` → `/rpc` proxy to `:8787` still carries `james.lvh.me`.

**Dispatcher refactor:**
- RPC handlers stop using the global `db`; the dispatcher builds a `ctx = { db, family, user }` per request and passes it in. Same `rpc()` shape on the client — no frontend breakage.

**New RPC:** `meta` → `{ family: { name, subdomain }, user, families }`.

---

## Phase 1 — Authentication (email + password) ✅ done

- Passwords hashed with `crypto.scrypt` (built-in, no new deps).
- Sessions: random 256-bit tokens in a `sessions` table; delivered as **httpOnly, `SameSite=Lax`** cookies.
- Cookie domain = parent domain (`.lvh.me` in dev) so a multi-family user switches families smoothly; the **membership check is the real security boundary** (the token only ever grants access to families the user belongs to). *Hardening option: scope the cookie per-subdomain and hop via a short-lived signed switch token — noted in Phase 4.*
- Onboarding: first user of an empty family becomes **admin**; admins invite others by email/link.
- RPC: `auth.signup`, `auth.login`, `auth.logout`, `auth.invite`, and `meta` reports `{ user, role, families }`.
- Guard middleware rejects every other RPC method when there's no valid session + membership for the current family (401 / 403).
- Families with no members are "bootstrap mode" (open) until the first person signs up.

---

## Phase 2 — Realtime updates

Wife adds "Whole Milk"; husband sees it before she's put her phone down.

- **Server-Sent Events** — an authorized `GET /events` endpoint on the existing plain-HTTP server (no `ws` dep). One-way push is exactly what we need; client→server already flows through RPC.
- On every successful mutation, the server broadcasts the fresh snapshot to the other connected clients in that family. Lists are small, so full-snapshot broadcast is simplest and self-healing.
- Client: `EventSource` + `rpc('snapshot')` to reconcile on connect and reconnect. Plays nicely with the existing offline queue (offline → queue + optimistic; online → live stream).
- Single-process note: an in-memory broadcast set works now; if we ever scale to multiple processes we'd swap in pub/sub (Redis).

---

## Phase 3 — Store tagging

Shop by store — Costco / Trader Joe's / Smith's.

- Schema: `tags` (id, name, icon, sort_order) + `item_tags` (item_id, tag_id) — many-to-many, an item can be at Costco *and* Smith's.
- Seed each family with **Costco 🛒, Trader Joe's 🥑, Smith's 🏬**; custom tags allowed.
- RPC: `listTags`, `addTag`, `setItemTags(itemId, tagIds)`, plus `snapshot` gains `tags` and items gain `tag_ids`.
- UI:
  - Multi-select tag chips in the add/edit bottom sheet.
  - Tag filter row beside the category chips.
  - **Shopping mode**: pick a store → only that store's items, grouped and checked off as you go.

---

## Phase 4 — Production hardening

- **HTTPS** — required for the PWA (service workers + `Secure` cookies). Real domain + subdomains replace lvh.me.
- Cookie hardening (per-subdomain sessions + signed switch token), rate-limiting on auth, brute-force backoff.
- WAL backups, schema migrations tooling, and automated tests (the RPC layer makes this easy to test end-to-end).
- Performance: keep tenant DBs tiny; revisit caching if the per-tenant file count grows.

---

## Sequencing

1. **Phase 0** first — everything depends on it. ~1 focused session.
2. **Phase 1** (auth) — unblocks real usage between two people.
3. **Phase 2** (realtime) — the "wow" moment for the two-of-us use case.
4. **Phase 3** (tags) — the everyday shopping workflow.
5. **Phase 4** as needed before real deployment.
