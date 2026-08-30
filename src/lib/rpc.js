const API = '/rpc'
const PENDING_KEY = 'groceries.pending.v1'

const MUTATIONS = new Set(['addItem', 'updateItem', 'setChecked', 'deleteItem', 'clearChecked'])
const READS = new Set(['listItems', 'listCategories', 'snapshot', 'suggestions', 'ping'])

const state = {
  offline: typeof navigator !== 'undefined' && navigator.onLine === false,
  pending: loadQueue().length,
}

const listeners = new Set()
function emit() {
  state.offline = typeof navigator !== 'undefined' && navigator.onLine === false
  state.pending = loadQueue().length
  for (const fn of listeners) fn({ ...state })
}

export class RpcError extends Error {
  constructor(message, { code = 'RPC', status = 0, offline = false } = {}) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.status = status
    this.offline = offline
  }
}

function loadQueue() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]')
  } catch {
    return []
  }
}

function saveQueue(q) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(q))
}

function queue(method, params) {
  const q = loadQueue()
  q.push({ method, params, at: Date.now() })
  saveQueue(q)
}

/**
 * Call an RPC method on the backend.
 * `const result = await rpc('addItem', { name: 'Milk' })`
 */
async function rpc(method, ...params) {
  let res
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params }),
    })
  } catch (err) {
    if (READS.has(method)) {
      emit()
      throw new RpcError('You are offline.', { code: 'OFFLINE', offline: true })
    }
    if (MUTATIONS.has(method)) queue(method, params)
    emit()
    throw new RpcError('Offline — saved to the queue, will sync when back online.', {
      code: 'OFFLINE',
      offline: true,
    })
  }

  let json = null
  try {
    json = await res.json()
  } catch {
    /* non-JSON response */
  }

  if (!res.ok || !json || json.ok !== true) {
    const err = json?.error || {}
    if (MUTATIONS.has(method) && res.status >= 500) queue(method, params)
    emit()
    throw new RpcError(err.message || `Request failed (${res.status})`, {
      code: err.code || 'RPC',
      status: res.status,
    })
  }

  emit()
  return json.result
}

async function flushQueue() {
  if (!navigator.onLine) return false
  let q = loadQueue()
  if (q.length === 0) return true
  let retried = []
  for (const op of q) {
    try {
      await rpc.raw(op.method, ...op.params)
    } catch (err) {
      if (err.offline || err.status === 0) {
        retried.push(op)
      }
    }
  }
  saveQueue(retried)
  emit()
  return retried.length === 0
}

/** Bypass the queue — used internally when replaying pending mutations. */
rpc.raw = async function raw(method, ...params) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params }),
  })
  const json = await res.json()
  if (!res.ok || !json?.ok) {
    throw new RpcError(json?.error?.message || 'Request failed', {
      code: json?.error?.code || 'RPC',
      status: res.status,
    })
  }
  return json.result
}

rpc.isOffline = () => state.offline
rpc.pendingCount = () => state.pending
rpc.onChange = (fn) => {
  listeners.add(fn)
  fn({ ...state })
  return () => listeners.delete(fn)
}
rpc.flushQueue = flushQueue

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    emit()
    flushQueue()
  })
  window.addEventListener('offline', emit)
}

export default rpc
