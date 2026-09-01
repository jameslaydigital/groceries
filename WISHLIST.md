# Syncart — Feature Wishlist

An unprioritized grab-bag of things we want some day. Nothing here is a
commitment — the committed plan lives in `ROADMAP.md`. Add ideas freely;
fold the winners into the roadmap when we decide to build them.

## Auth & accounts
- [ ] **Self-serve password reset** — "Forgot password" on the login screen that emails a `/reset/<token>` link, instead of only admins being able to mint one.
- [ ] **Email delivery** — wire invites and password resets through a transactional provider (Resend/SES/Postmark) so links don't have to be copy-pasted out of the members panel.
- [ ] **Invite/share sheet** — native share sheet / QR code for the invite link, plus a "copy invite link" action right after inviting.
- [ ] **Role management** — promote/demote admins, leave-family, remove a member.
- [ ] **Per-subdomain sessions** — scope the session cookie to the subdomain and hop with a short-lived signed switch token, instead of one parent-domain cookie (threat-model hardening).
- [ ] **Transactional Email** — To allow self-serve sign-up.
- [ ] **Transactional SMS** — Another factor for authentication.
- [ ] **OTP Authentication** — Another factor for authentication.
- [ ] **Passkey Authentication** — Another path to authentication.

## Business preparation
- [ ] **Payment Integration** — To allow people to provision their own families / tenants.
- [ ] **App Store Preparation** — To allow people to install straight from the play store or apple store.

## Shopping UX
- [ ] **Item attribution** — record which member added/checked each item ("James added milk").
- [x] **Add stores from the UI** — create a new store (name + icon) right from the add sheet; an item can already be tagged to multiple stores.
- [x] **Item memory in the add sheet** — typing in the add sheet recalls items you've added before (with their usual qty/category/stores) so you can pick and go.
- [x] **Delete remembered items** — a ✕ on each suggestion forgets that item from memory.
- [x] **Direct item delete** — a clear "Delete item" button in the edit sheet (plus the existing swipe-to-delete), so removing an item doesn't require digging through the modal.
- [ ] **Purchase cadence suggestions** — log when items get checked off; for things you buy regularly, surface "you usually buy X about every N days — it's been longer" based on the average gap between purchases.
- [ ] **Barcode scan** — camera-to-item lookup for quick adds.
- [x] **Store aisle / price hints** — optional notes on items (aisle, sale price, preferred brand).
- [x] **Favorites / recurring items** — star an item in the add sheet to keep it as a one-tap "always have" quick-add.
- [ ] **Meal planning** — plan dinners; items auto-added to the list.
- [ ] **Multiple lists** — weekly/dinner lists within a family, alongside the single shared list.
- [ ] **Sort/group improvements** — manual sort, "add all to Costco trip", per-store export.
- [ ] **Purchase Link** — link attached to an item that can be followed to add something to an online cart directly (e.g. an amazon page)

## Offline & sync
- [ ] **Offline conflict resolution** — explicit conflict badges when an item was edited on two devices, instead of silently converging by idempotency.
- [ ] **Pull-to-refresh / sync status** — visible "last synced at" and per-change status.
- [ ] **Multi-process support** — swap the in-memory SSE broadcast for pub/sub so we can run more than one replica.

## Platform & infra
- [ ] **HTTPS + wildcard cert** — Caddy built with the Linode DNS module; flip `COOKIE_SECURE=1` and `COOKIE_DOMAIN=.progressive-apps.com`; drop the plain `:80` site.
- [ ] **In-app family creation** — spin up a new subdomain from the UI instead of `npm run family create`.
- [ ] **Domain rename / family settings** — change family name, transfer admin, archive a family.
- [ ] **Backup restore UI** — restore a snapshot from the backups dir via the CLI (or UI).
- [ ] **Analytics** — light, privacy-respecting usage stats (who's active, list size) to know if it's worth iterating.

## Delight
- [ ] **Emoji reactions** — react to items ("🙏 avocado", "🤨 who bought this?").
- [x] **Themes** — a couple of alternate colorways (ocean / berry / sunset) toggled from the header, persisted per device.
- [x] **Haptics / confetti** — confetti burst + vibration when the last item is checked off.
- [ ] **Widgets** — iOS/Android home-screen widget for the current list.
