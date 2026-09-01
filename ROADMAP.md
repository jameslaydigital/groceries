# Syncart — Roadmap

A grocery list PWA for a family. Mobile-first, offline-capable, installable. Backend is Node + `node:sqlite`; frontend is Svelte 5 + Vite; the two communicate over a JSON-RPC layer (`rpc('method', ...args)`).

**North star:** two people in different rooms, same list — one checks off avocados, the other's phone updates instantly, and both can shop at whichever store the item lives at.

---

## Phase 0 — Multi-tenancy foundation ✅ done

The current `server.js` opened a single `groceries.db` at startup and every RPC handler used a global `db`. Now it's multi-tenant.

**Two databases:**
- **`platform.db`** (global): `users`, `families`, `memberships`, `sessions`
- **`families/<subdomain>.db`** (per tenant): categories, items, tags, item_tags

**Tenant resolution:**
- The tenant key is the **leftmost label** of the `Host` header — base-domain agnostic, so `james.lvh.me`, `james.progressive-apps.com`, or `james.any-domain.net` all resolve to the `james` family with no configuration.
- `localhost`/loopback and `DEFAULT_HOSTS` env (bare IPs before DNS is wired) map to the default (`home`) family. Unknown labels → `NO_FAMILY`.
- Look up the family in `platform.db`; lazily open (and cache) that family's sqlite file.
- Migrations per tenant DB tracked via `PRAGMA user_version`.
- Vite's dev proxy preserves the original `Host` header, so `james.lvh.me:5173` → `/rpc` proxy to `:8787` still carries `james.lvh.me`.

**Dispatcher refactor:**
- RPC handlers stop using the global `db`; the dispatcher builds a `ctx = { db, family, user }` per request and passes it in. Same `rpc()` shape on the client — no frontend breakage.

**New RPC:** `meta` → `{ family: { name, subdomain }, user, role, families, bootstrap }`.

---

## Phase 1 — Authentication (email + password) ✅ done

- Passwords hashed with `crypto.scrypt` (built-in, no new deps).
- Sessions: random 256-bit tokens in a `sessions` table; delivered as **httpOnly, `SameSite=Lax`** cookies.
- Cookie domain = parent domain (`.lvh.me` in dev) so a multi-family user switches families smoothly; the **membership check is the real security boundary** (the token only ever grants access to families the user belongs to). *Hardening option: scope the cookie per-subdomain and hop via a short-lived signed switch token — noted in Phase 4.*
- Onboarding: first user of an empty family becomes **admin**; admins invite others via secure one-time links (`/invite/accept/<token>`, 256-bit tokens, single-use, revocable).
- **Members panel** (`src/components/MembersPanel.svelte`): roster with admin badges, invite-by-email form, pending-invite management (copy link / revoke), and admin-minted password-reset links.
- **Password reset** — admins mint a one-time `/reset/<token>` link (24h) per member; the member sets a new password and all their sessions are invalidated. No self-serve reset yet (no email delivery).
- RPC: `auth.signup` (takes an invite `token` for private families), `auth.login`, `auth.logout`, `auth.invite` (returns a token), `auth.inviteInfo`, `auth.resetPasswordLink`, `auth.resetPasswordInfo`, `auth.resetPassword`, `revokeInvite`, `listMembers`, and `meta` reports `{ user, role, families, bootstrap }`.
- Guard middleware rejects every other RPC method when there's no valid session + membership for the current family (401 / 403).
- Families with no members are "bootstrap mode" (open) until the first person signs up.

---

## Phase 2 — Realtime updates ✅ done

Wife adds "Whole Milk"; husband sees it before she's put her phone down.

- **Server-Sent Events** — an authorized `GET /events` endpoint on the existing plain-HTTP server (no `ws` dep). One-way push is exactly what we need; client→server already flows through RPC.
- On every successful mutation, the server broadcasts the fresh snapshot to the other connected clients in that family. Lists are small, so full-snapshot broadcast is simplest and self-healing.
- Client: `EventSource` + `rpc('snapshot')` to reconcile on connect and reconnect. Plays nicely with the existing offline queue (offline → queue + optimistic; online → live stream).
- Single-process note: an in-memory broadcast set works now; if we ever scale to multiple processes we'd swap in pub/sub (Redis).

---

## Phase 3 — Store tagging ✅ done

Shop by store — Costco / Trader Joe's / Smith's.

- Schema: `tags` (id, name, icon, sort_order) + `item_tags` (item_id, tag_id) — many-to-many, an item can be at Costco *and* Smith's.
- Seed each family with **Costco 🛒, Trader Joe's 🥑, Smith's 🏬**; custom tags allowed.
- RPC: `listTags`, `addTag`, `setItemTags(itemId, tagIds)`, plus `snapshot` gains `tags` and items gain `tag_ids`.
- UI:
  - Multi-select tag chips in the add/edit bottom sheet.
  - Tag filter row beside the category chips.
  - **Shopping mode**: pick a store → only that store's items, grouped and checked off as you go.

---

## Phase 4 — Production hardening (mostly done)

- ✅ **Brute-force protection** — at most one failed login/signup attempt per second (per IP and per email, `AUTH_RATE_MS`), cleared on success so a correct password is never met with a lockout.
- ✅ **Backups** — `npm run backup` snapshots `platform.db` + every tenant DB via `VACUUM INTO` into timestamped `backups/` dirs.
- ✅ **Session hardening** — only a sha256 hash of the session token is stored; sessions expire after 30 days and are rejected when expired.
- ✅ **Cookie flags** — `HttpOnly`, `SameSite=Lax`; `Secure` when `COOKIE_SECURE=1`.
- ✅ **Live deployment** — native Linode box behind Caddy, real wildcard domain (`*.progressive-apps.com` → `23.239.29.165`), systemd unit + nightly `VACUUM INTO` backups. App is bound to loopback; only Caddy reaches it.
- ⏳ **HTTPS/TLS** — still serving plain HTTP (interim `:80` Caddy proxy). Needs the Caddy binary built with the Linode DNS module for a wildcard cert, then `COOKIE_SECURE=1` + `COOKIE_DOMAIN=.progressive-apps.com`. Required for the PWA install prompt and secure cookies.
- ⏳ **Self-serve password reset** — currently only admins can mint reset links; a user can't request one for themselves (needs email delivery).
- ⏳ **Hardening option** — per-subdomain sessions with a short-lived signed switch token (instead of the parent-domain cookie) if the threat model ever warrants it.
- ⏳ **Scale-out** — the in-memory SSE broadcast means a single process; swap in pub/sub (Redis) if ever running multiple replicas.

---

## Now / Next

1. **HTTPS** — wildcard cert via Caddy + Linode DNS module; flip `COOKIE_SECURE=1`, `COOKIE_DOMAIN=.progressive-apps.com`; drop the plain `:80` site. Unlocks the PWA install prompt.
2. **Self-serve password reset** — "forgot password" on the login screen that emails a `/reset/<token>` link (needs an email/SMTP path for invites and resets alike).
3. **Family provisioning from the UI** — today families are created via `npm run family create`; a "create family" flow in-app would let anyone spin up a subdomain without shell access.

## Backlog (ideas, not committed)

- **Item attribution** — record which member added/checked each item, surfaced in the UI ("James added milk").
- **Barcode scan** — camera-to-item lookup (via a local data source or manual mapping) for quick adds.
- **Multiple lists** — e.g. weekly/dinner lists within a family, in addition to the single shared list.
- **Offline conflict resolution** — today offline edits replay optimistically and converge by idempotency; explicit conflict badges for items edited on two devices would be clearer.
- **Email delivery** — wire invites and password resets through a transactional email provider so links don't require manual copy-paste.

---

## Sequencing (historical)

1. **Phase 0** first — everything depends on it. ~1 focused session.
2. **Phase 1** (auth) — unblocks real usage between two people.
3. **Phase 2** (realtime) — the "wow" moment for the two-of-us use case.
4. **Phase 3** (tags) — the everyday shopping workflow.
5. **Phase 4** as needed before real deployment.
