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
- [ ] **Back button to close the edit/add item modal** - when editing or adding an item, left swipe closes the app when you really just want to get rid of the keyboard.
- [ ] **Don't autofocus inputs when opening edit modal** - the keyboard pops up and hides the ui.
- [ ] **Visually Represent Date Last Purchased** - perhaps something like "last purchase 3 weeks ago".
- [ ] **Back-swipe 2x at home screen to exit app** - on the first one it should say in a toast "swipe again to close the app".
- [ ] **Item Links Take You To The Purchase Site** - on items that have website links, you can click to go straight to the link and purchase it.
- [x] **Item attribution** — record which member added/checked each item ("James added milk").
- [x] **Add Item Wizard to Replace Modal** — instead of the add item process being a modal, it should be a 3-step wizard. Enter the name and qty. Choose category and stores. Add links or notes. Ask "add another or return to shopping list?". Checkmark UI feedback upon completion.
- [x] **Add stores from the UI** — create a new store (name + icon) right from the add sheet; an item can already be tagged to multiple stores.
- [x] **Item memory in the add sheet** — typing in the add sheet recalls items you've added before (with their usual qty/category/stores) so you can pick and go.
- [x] **Delete remembered items** — a ✕ on each suggestion forgets that item from memory.
- [x] **Reliable item delete + undo** — an always-visible ✕ on each row deletes immediately with an Undo toast (the old swipe-reveal ✕ was opening the edit modal instead of deleting).
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
- [ ] **HTTPS + wildcard cert** — Caddy built with the Linode DNS module; flip `COOKIE_SECURE=1` and `COOKIE_DOMAIN=.yourdomain.com`; drop the plain `:80` site.
- [ ] **In-app family creation** — spin up a new subdomain from the UI instead of `npm run family create`.
- [ ] **Domain rename / family settings** — change family name, transfer admin, archive a family.
- [ ] **Backup restore UI** — restore a snapshot from the backups dir via the CLI (or UI).
- [ ] **Analytics** — light, privacy-respecting usage stats (who's active, list size) to know if it's worth iterating.

## Delight
- [ ] **Emoji reactions** — react to items ("🙏 avocado", "🤨 who bought this?").
- [x] **Themes** — a couple of alternate colorways (ocean / berry / sunset) toggled from the header, persisted per device.
- [x] **Haptics / confetti** — confetti burst + vibration when the last item is checked off.
- [ ] **Widgets** — iOS/Android home-screen widget for the current list.
