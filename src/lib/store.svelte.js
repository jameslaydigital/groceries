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

export function toast(message, icon = '🍏') {
  ui.toast = { message, icon }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (ui.toast = null), 2600)
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

export async function addItem({ name, quantity, category, tag_ids }) {
  const pending = {
    id: -Date.now(),
    name,
    quantity,
    category,
    checked: 0,
    category_icon: categoryIcon(category),
    tag_ids: tag_ids ?? [],
  }
  data.items.unshift(pending)
  sortItems()
  ui.adding = false
  markDirty()

  try {
    const saved = await rpc('addItem', { name, quantity, category, tag_ids: tag_ids ?? [] })
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

export async function removeItem(id) {
  const idx = data.items.findIndex((i) => i.id === id)
  if (idx === -1) return
  const [removed] = data.items.splice(idx, 1)
  markDirty()
  try {
    await rpc('deleteItem', id)
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

export function tagsById() {
  return new Map(data.tags.map((t) => [t.id, t]))
}
