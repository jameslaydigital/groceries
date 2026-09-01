import rpc from './rpc.js'

const STATE_KEY = 'groceries.state.v1'

export const data = $state({ categories: [], items: [], tags: [] })
export const family = $state({ name: '', subdomain: '', bootstrap: false })
export const user = $state({ id: null, email: '', display_name: '', role: null, families: [] })
export const members = $state({ list: [], invites: [], loaded: false })
export const auth = $state({ status: 'loading' }) // loading | anon | authed
export const ui = $state({
  ready: false,
  adding: false,
  editing: null,
  search: '',
  activeCategory: 'All',
  activeTag: null,
  toast: null,
})

const AUTH_KEY = 'groceries.auth'
const THEME_KEY = 'groceries.theme'

export const THEMES = ['market', 'ocean', 'berry', 'sunset']
export const theme = $state({ name: 'market' })

// Quiet, desaturated status-bar tones per theme — the bright accent was
// drawing too much attention in the Android titlebar.
const STATUS_COLORS = {
  market: '#2f4a3c',
  ocean: '#23465c',
  berry: '#4a2d52',
  sunset: '#59381f',
}

function readTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY)
    return THEMES.includes(t) ? t : 'market'
  } catch {
    return 'market'
  }
}

function setDomTheme(name) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = name === 'market' ? '' : name
  const color = STATUS_COLORS[name] || STATUS_COLORS.market
  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', color)
}

export function applyTheme(name) {
  const t = THEMES.includes(name) ? name : 'market'
  theme.name = t
  setDomTheme(t)
  try {
    localStorage.setItem(THEME_KEY, t)
  } catch {
    /* storage unavailable */
  }
}

export function initTheme() {
  const t = readTheme()
  theme.name = t
  setDomTheme(t)
}

function persistAuth(status) {
  try {
    localStorage.setItem(AUTH_KEY, status)
  } catch {
    /* ignore */
  }
}

export function applyMeta(m) {
  family.name = m.family?.name ?? ''
  family.subdomain = m.family?.subdomain ?? ''
  family.bootstrap = !!m.bootstrap
  user.id = m.user?.id ?? null
  user.email = m.user?.email ?? ''
  user.display_name = m.user?.display_name ?? ''
  user.role = m.role ?? null
  user.families = Array.isArray(m.families) ? m.families : []
  const status = m.user ? 'authed' : 'anon'
  if (status !== 'loading') {
    auth.status = status
    persistAuth(status)
  }
}

let toastTimer

export function toast(message, icon = '🍏', action = null) {
  ui.toast = { message, icon, action }
  clearTimeout(toastTimer)
  // an actionable toast (e.g. Undo) stays up longer
  toastTimer = setTimeout(() => (ui.toast = null), action ? 6000 : 2600)
}

function readLocal() {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return null
    const snap = JSON.parse(raw)
    if (Array.isArray(snap.items) && Array.isArray(snap.categories)) return snap
    return null
  } catch {
    return null
  }
}

function persist() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(data))
  } catch {
    /* storage full or unavailable */
  }
}

function markDirty() {
  persist()
}

export async function load() {
  try {
  const local = readLocal()
  if (local) {
    data.categories = local.categories ?? []
    data.tags = local.tags ?? []
    data.items = (local.items ?? []).map((i) => ({ ...i, category_icon: i.category_icon ?? categoryIcon(i.category), tag_ids: i.tag_ids ?? [] }))
    ui.ready = true
  }
  } catch {
    /* no local state */
  }

  try {
    const m = await rpc('meta')
    applyMeta(m)
  } catch {
    // offline — fall back to the last known auth state
    try {
      auth.status = localStorage.getItem(AUTH_KEY) === 'authed' ? 'authed' : 'anon'
    } catch {
      auth.status = 'anon'
    }
  }

  try {
    const snap = await rpc('snapshot')
    refresh(snap)
  } catch (err) {
    if (err.code === 'AUTH_REQUIRED') {
      auth.status = 'anon'
      persistAuth('anon')
    } else if (err.code === 'FORBIDDEN') {
      auth.status = 'anon'
      persistAuth('anon')
      toast('You’re not a member of this family', '🔒')
    }
    /* offline — stay with local state */
  } finally {
    ui.ready = true
  }
}

export async function login(email, password) {
  const m = await rpc('auth.login', { email, password })
  applyMeta(m)
  toast(`Welcome back${m.user?.display_name ? ', ' + m.user.display_name : ''}!`, '👋')
  await load()
}

export async function signup(email, password, name, token) {
  const m = await rpc('auth.signup', { email, password, name, ...(token ? { token } : {}) })
  applyMeta(m)
  toast(m.role === 'admin' ? 'Family created — you’re the admin!' : 'Welcome to the family!', '🎉')
  await load()
}

export async function logout() {
  try {
    await rpc('auth.logout')
  } catch {
    /* session may already be gone */
  }
  user.id = null
  user.email = ''
  user.display_name = ''
  user.role = null
  user.families = []
  auth.status = 'anon'
  persistAuth('anon')
}

export async function invite(email) {
  const res = await rpc('auth.invite', { email })
  await listMembers().catch(() => {})
  return res
}

export async function listMembers() {
  const res = await rpc('listMembers')
  members.list = res.members ?? []
  members.invites = res.invites ?? []
  members.loaded = true
  return res
}

export async function revokeInvite(id) {
  await rpc('revokeInvite', { id })
  members.invites = members.invites.filter((i) => i.id !== id)
}

export function generateResetLink(userId) {
  return rpc('auth.resetPasswordLink', { userId })
}

export function resetPassword(token, password) {
  return rpc('auth.resetPassword', { token, password })
}

function sortItems() {
  const order = new Map(data.categories.map((c) => [c.name, c.sort_order]))
  data.items.sort((a, b) => {
    const ca = order.get(a.category) ?? 999
    const cb = order.get(b.category) ?? 999
    if (ca !== cb) return ca - cb
    if (a.checked !== b.checked) return a.checked ? 1 : -1
    return a.name.localeCompare(b.name)
  })
}

export async function addItem({ name, quantity, category, tag_ids, notes }) {
  const pending = {
    id: -Date.now(),
    name,
    quantity,
    category,
    notes: notes ?? '',
    checked: 0,
    category_icon: categoryIcon(category),
    tag_ids: tag_ids ?? [],
  }
  data.items.unshift(pending)
  sortItems()
  ui.adding = false
  markDirty()

  try {
    const saved = await rpc('addItem', { name, quantity, category, tag_ids: tag_ids ?? [], notes: notes ?? '' })
    // Idempotent reconciliation: a live snapshot may have already inserted
    // the saved item, so remove the pending temp row and only add the real
    // one if it isn't present yet.
    data.items = data.items.filter((i) => i.id !== pending.id)
    if (!data.items.some((i) => i.id === saved.id)) {
      data.items.push({ ...saved, category_icon: categoryIcon(saved.category), tag_ids: saved.tag_ids ?? [] })
    }
    sortItems()
    markDirty()
    await rpc('snapshot').then(refresh).catch(() => {})
  } catch (err) {
    if (err.code === 'OFFLINE') {
      toast('Saved — will sync when online', '🛜')
    } else {
      data.items = data.items.filter((i) => i.id !== pending.id)
      markDirty()
      toast(err.message, '⚠️')
    }
  }
}

export function refresh(snap) {
  if (!snap) return
  data.categories = snap.categories
  data.tags = snap.tags ?? []
  const pending = data.items.filter((i) => i.id < 0)
  const key = (i) => `${i.name}|${i.category}|${i.quantity}`.toLowerCase()
  const snapshotKeys = new Set(snap.items.map(key))
  // Keep items added while offline (negative temp ids) visible until they're
  // reconciled — but drop any pending item the snapshot already contains so a
  // live update mid-add can't leave a duplicate behind.
  const keepPending = pending.filter((p) => !snapshotKeys.has(key(p)))
  data.items = snap.items.map((i) => ({
    ...i,
    category_icon: i.category_icon ?? categoryIcon(i.category),
    tag_ids: i.tag_ids ?? [],
  }))
  if (keepPending.length) data.items.push(...keepPending)
  sortItems()
  markDirty()
}

export async function toggleItem(item) {
  const next = item.checked ? 0 : 1
  item.checked = next
  sortItems()
  markDirty()
  try {
    await rpc('setChecked', item.id, !!next)
    rpc('snapshot').then(refresh).catch(() => {})
  } catch (err) {
    item.checked = next ? 0 : 1
    sortItems()
    markDirty()
    if (err.code !== 'OFFLINE') toast(err.message, '⚠️')
  }
}

export async function updateItem(id, patch) {
  const local = data.items.find((i) => i.id === id)
  const prev = local ? { ...local } : null
  if (local) Object.assign(local, patch, { category_icon: categoryIcon(patch.category ?? local.category) })
  sortItems()
  markDirty()
  try {
    const saved = await rpc('updateItem', id, patch)
    const idx = data.items.findIndex((i) => i.id === id)
    if (idx !== -1) data.items[idx] = { ...saved, category_icon: categoryIcon(saved.category), tag_ids: saved.tag_ids ?? [] }
    sortItems()
    markDirty()
    rpc('snapshot').then(refresh).catch(() => {})
  } catch (err) {
    if (prev && local) Object.assign(local, prev)
    sortItems()
    markDirty()
    if (err.code !== 'OFFLINE') toast(err.message, '⚠️')
  }
}

export async function removeItem(item) {
  const idx = data.items.findIndex((i) => i.id === item.id)
  if (idx === -1) return
  const [removed] = data.items.splice(idx, 1)
  markDirty()

  let restored = false
  const undo = () => {
    if (restored) return
    restored = true
    addItem({
      name: removed.name,
      quantity: removed.quantity,
      category: removed.category,
      tag_ids: removed.tag_ids ?? [],
      notes: removed.notes ?? '',
    })
  }

  try {
    await rpc('deleteItem', item.id)
    if (!restored) toast(`Deleted ${removed.name}`, '🗑️', { label: 'Undo', run: undo })
    rpc('snapshot').then(refresh).catch(() => {})
  } catch (err) {
    data.items.splice(idx, 0, removed)
    sortItems()
    markDirty()
    if (err.code !== 'OFFLINE') toast(err.message, '⚠️')
  }
}

export async function clearChecked() {
  const removed = data.items.filter((i) => i.checked)
  if (!removed.length) return
  data.items = data.items.filter((i) => !i.checked)
  markDirty()
  try {
    const res = await rpc('clearChecked')
    toast(`Cleared ${res.removed} item${res.removed === 1 ? '' : 's'}`, '🧹')
    rpc('snapshot').then(refresh).catch(() => {})
  } catch (err) {
    if (err.code !== 'OFFLINE') {
      data.items = [...data.items, ...removed]
      sortItems()
      markDirty()
      toast(err.message, '⚠️')
    }
  }
}

export function categoryIcon(name) {
  return data.categories.find((c) => c.name === name)?.icon ?? '🛒'
}

export async function addTag(name, icon) {
  const tag = await rpc('addTag', { name, icon })
  if (!data.tags.some((t) => t.id === tag.id)) {
    data.tags.push(tag)
    markDirty()
  }
  return tag
}

export function setFavorite(name, favorite) {
  return rpc('setFavorite', { name, favorite })
}

export function listFavorites() {
  return rpc('listFavorites')
}

export function tagsById() {
  return new Map(data.tags.map((t) => [t.id, t]))
}
