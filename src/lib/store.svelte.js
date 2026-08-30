import rpc from './rpc.js'

const STATE_KEY = 'groceries.state.v1'

export const data = $state({ categories: [], items: [] })
export const ui = $state({
  ready: false,
  adding: false,
  editing: null,
  search: '',
  activeCategory: 'All',
  toast: null,
})

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
  const local = readLocal()
  if (local) {
    data.categories = local.categories
    data.items = local.items.map((i) => ({ ...i, category_icon: i.category_icon ?? categoryIcon(i.category) }))
    ui.ready = true
  }
  try {
    const snap = await rpc('snapshot')
    refresh(snap)
  } catch {
    /* stay with local state while offline */
  } finally {
    ui.ready = true
  }
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

export async function addItem({ name, quantity, category }) {
  const pending = {
    id: -Date.now(),
    name,
    quantity,
    category,
    checked: 0,
    category_icon: categoryIcon(category),
  }
  data.items.unshift(pending)
  sortItems()
  ui.adding = false
  markDirty()

  try {
    const saved = await rpc('addItem', { name, quantity, category })
    const idx = data.items.findIndex((i) => i.id === pending.id)
    if (idx !== -1) data.items[idx] = { ...saved, category_icon: categoryIcon(saved.category) }
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

async function refresh(snap) {
  if (!snap) return
  data.categories = snap.categories
  data.items = snap.items.map((i) => ({ ...i, category_icon: i.category_icon ?? categoryIcon(i.category) }))
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
    if (idx !== -1) data.items[idx] = { ...saved, category_icon: categoryIcon(saved.category) }
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
