import { refresh } from './store.svelte.js'

let es = null

export function connectRealtime() {
  disconnectRealtime()
  if (typeof EventSource === 'undefined') return
  es = new EventSource('/events')
  es.addEventListener('snapshot', (e) => {
    try {
      refresh(JSON.parse(e.data))
    } catch {
      /* malformed frame — ignore */
    }
  })
  // EventSource reconnects automatically on drop; the snapshot frames
  // keep the list converged without any extra plumbing.
}

export function disconnectRealtime() {
  if (es) {
    es.close()
    es = null
  }
}
