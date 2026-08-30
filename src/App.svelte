<script>
  import { onMount } from 'svelte'
  import ProgressRing from './components/ProgressRing.svelte'
  import ItemRow from './components/ItemRow.svelte'
  import AddSheet from './components/AddSheet.svelte'
  import AuthScreen from './components/AuthScreen.svelte'
  import { data, ui, load, clearChecked, toast, family, user, auth, logout } from './lib/store.svelte.js'
  import { connectRealtime, disconnectRealtime } from './lib/realtime.js'
  import rpc from './lib/rpc.js'

  let showSheet = $state(false)
  let installPrompt = $state(null)
  let installed = $state(false)
  let conn = $state({ offline: false, pending: 0 })

  $effect(() => {
    if (ui.editing) showSheet = true
  })

  let items = $derived(data.items)
  let total = $derived(items.length)
  let done = $derived(items.filter((i) => i.checked).length)
  let pending = $derived(total - done)
  let activeTag = $derived(data.tags.find((t) => t.id === ui.activeTag) ?? null)

  let filtered = $derived.by(() => {
    const q = ui.search.trim().toLowerCase()
    return items.filter((i) => {
      const inCat = ui.activeCategory === 'All' || i.category === ui.activeCategory
      const inTag = !ui.activeTag || (i.tag_ids ?? []).includes(ui.activeTag)
      const inSearch =
        !q || i.name.toLowerCase().includes(q) || i.quantity.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)
      return inCat && inTag && inSearch
    })
  })

  let groups = $derived.by(() => {
    const out = []
    const order = new Map(data.categories.map((c) => [c.name, c.sort_order]))
    for (const item of filtered) {
      let g = out[out.length - 1]
      if (!g || g.name !== item.category) {
        g = { name: item.category, icon: item.category_icon ?? '🛒', items: [] }
        out.push(g)
      }
      g.items.push(item)
    }
    return out
  })

  let checkedCount = $derived(items.filter((i) => i.checked).length)
  let subtitle = $derived(
    total === 0
      ? 'Nothing yet — add your first item below'
      : pending === 0
        ? 'All done! Time to check out 🎉'
        : `${pending} item${pending === 1 ? '' : 's'} to grab`
  )

  let deferred

  $effect(() => {
    if (auth.status === 'authed') connectRealtime()
    else disconnectRealtime()
  })

  onMount(() => {
    load()
    let wasOffline = false
    const off = rpc.onChange((s) => {
      conn.offline = s.offline
      conn.pending = s.pending
      if (wasOffline && !s.offline) load()
      wasOffline = s.offline
    })

    const onPrompt = (e) => {
      e.preventDefault()
      installPrompt = e
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', () => {
      installed = true
      installPrompt = null
    })

    return () => {
      off()
      window.removeEventListener('beforeinstallprompt', onPrompt)
    }
  })

  async function install() {
    if (!installPrompt) return
    installPrompt.prompt()
    await installPrompt.userChoice
    installPrompt = null
  }

  function openAdd() {
    ui.editing = null
    ui.toast = null
    showSheet = true
  }

  function goToFamily(subdomain) {
    if (subdomain === family.subdomain) return
    const host = window.location.hostname
    const port = window.location.port ? `:${window.location.port}` : ''
    let newHost
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.lvh.me')) {
      newHost = `${subdomain}.lvh.me`
    } else {
      const labels = host.split('.')
      newHost = labels.length > 2 ? `${subdomain}.${labels.slice(1).join('.')}` : `${subdomain}.${host}`
    }
    window.location.href = `${window.location.protocol}//${newHost}${port}${window.location.pathname}`
  }
</script>

{#if auth.status === 'anon'}
  <AuthScreen />
{:else}
  <main class="app">
  <div class="blobs" aria-hidden="true">
    <span class="blob b1"></span>
    <span class="blob b2"></span>
    <span class="blob b3"></span>
  </div>

  <div class="sheet-anchor">
    <AddSheet bind:open={showSheet} />

    {#if conn.offline}
      <div class="offline-banner">
        <span class="dot"></span>
        Offline{conn.pending ? ` · ${conn.pending} change${conn.pending === 1 ? '' : 's'} queued` : ''}
        — will sync when back online
      </div>
    {/if}

    <header>
      <div class="titles">
        <h1>
          <span class="leaf">🥬</span> Groceries
        </h1>
        <p>{subtitle}</p>
      </div>
      <div class="header-right">
        {#if family.name}
          {#if user.families.length > 1}
            <select class="switcher" value={family.subdomain} onchange={(e) => goToFamily(e.target.value)} aria-label="Switch family">
              {#each user.families as f (f.subdomain)}
                <option value={f.subdomain}>{f.name}</option>
              {/each}
            </select>
          {:else}
            <span class="family-pill" title={family.subdomain}>{family.name}</span>
          {/if}
        {/if}
        {#if user.id}
          <button class="logout" onclick={logout} aria-label="Log out" title="Log out">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5M21 12H9" />
            </svg>
          </button>
        {/if}
        {#if installPrompt && !installed}
          <button class="install" onclick={install} aria-label="Install app">⤓ Install</button>
        {/if}
        <ProgressRing {total} {done} />
      </div>
    </header>

    <div class="search-wrap">
      <span class="search-ico">🔍</span>
      <input
        bind:value={ui.search}
        type="search"
        placeholder="Search the list…"
        aria-label="Search items"
      />
      {#if ui.search}
        <button class="clear" onclick={() => (ui.search = '')} aria-label="Clear search">✕</button>
      {/if}
    </div>

    <div class="chips">
      <button class="chip" class:active={ui.activeCategory === 'All'} onclick={() => (ui.activeCategory = 'All')}>
        <span>🍎</span> All
      </button>
      {#each data.categories as c (c.name)}
        <button
          class="chip"
          class:active={ui.activeCategory === c.name}
          onclick={() => (ui.activeCategory = c.name)}
        >
          <span>{c.icon}</span> {c.name}
          {#if c.item_count > 0}
            <b>{c.item_count}</b>
          {/if}
        </button>
      {/each}
    </div>

    {#if data.tags.length}
      <div class="chips tags">
        {#each data.tags as t (t.id)}
          <button
            class="chip"
            class:active={ui.activeTag === t.id}
            onclick={() => (ui.activeTag = ui.activeTag === t.id ? null : t.id)}
          >
            <span>{t.icon}</span> {t.name}
          </button>
        {/each}
      </div>
    {/if}

    {#if activeTag}
      <div class="shopping-banner">
        <span class="shop-icon">{activeTag.icon}</span>
        Shopping at {activeTag.name}
        <button class="clear-tag" onclick={() => (ui.activeTag = null)} aria-label="Clear store filter">✕</button>
      </div>
    {/if}

    {#if checkedCount > 0}
      <button class="clear-checked" onclick={clearChecked}>
        🧹 Clear {checkedCount} checked
      </button>
    {/if}

    <div class="list-wrap">
      {#if !ui.ready}
        <div class="skeleton" aria-label="Loading">
          {#each Array.from({ length: 6 }) as _, i (i)}
            <div class="sk"></div>
          {/each}
        </div>
      {:else if filtered.length === 0}
        <div class="empty">
          <div class="empty-art">
            <span class="e e1">🥕</span>
            <span class="e e2">🫐</span>
            <span class="e e3">🥚</span>
            <span class="e e4">🍌</span>
            <span class="basket">🧺</span>
          </div>
          <h3>{total === 0 ? 'Your basket is empty' : 'No matches'}</h3>
          <p>
            {total === 0
              ? 'Tap the button below to start building your list.'
              : 'Try a different search or category.'}
          </p>
          {#if total === 0}
            <button class="cta" onclick={openAdd}>Add your first item</button>
          {/if}
        </div>
      {:else}
        <div class="groups">
          {#each groups as group, gi (group.name)}
            <div class="group" style="--d: {gi * 45}ms">
              <div class="group-head">
                <span class="g-icon">{group.icon}</span>
                <h3>{group.name}</h3>
                <span class="count">{group.items.length}</span>
              </div>
              <div class="items">
                {#each group.items as item (item.id)}
                  <ItemRow {item} />
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="fab-space" aria-hidden="true"></div>

    <button class="fab" onclick={openAdd} aria-label="Add item">
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>

    {#if ui.toast}
      <div class="toast" role="status">
        <span>{ui.toast.icon}</span> {ui.toast.message}
      </div>
    {/if}
  </div>
  </main>
{/if}

<style>
  .app {
    min-height: 100svh;
  }
  .sheet-anchor {
    position: relative;
    width: min(100%, 560px);
    margin: 0 auto;
    padding:
      calc(20px + env(safe-area-inset-top)) 20px
      calc(110px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-sizing: border-box;
  }

  .blobs {
    position: fixed;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    pointer-events: none;
  }
  .blob {
    position: absolute;
    border-radius: 50%;
    filter: blur(70px);
    opacity: 0.5;
    animation: drift 18s ease-in-out infinite alternate;
  }
  .b1 {
    width: 320px;
    height: 320px;
    top: -90px;
    left: -80px;
    background: radial-gradient(circle at 30% 30%, #a7f3d0, #34d399 60%, transparent);
  }
  .b2 {
    width: 280px;
    height: 280px;
    top: 30%;
    right: -110px;
    background: radial-gradient(circle at 40% 40%, #fecdd3, #fda4af 55%, transparent);
    animation-delay: -6s;
  }
  .b3 {
    width: 260px;
    height: 260px;
    bottom: -80px;
    left: 10%;
    background: radial-gradient(circle at 50% 50%, #fde68a, #fcd34d 50%, transparent);
    animation-delay: -12s;
  }
  @keyframes drift {
    from {
      transform: translate3d(0, 0, 0) scale(1);
    }
    to {
      transform: translate3d(40px, 30px, 0) scale(1.12);
    }
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    animation: fade-down 0.5s ease both;
  }
  .titles h1 {
    margin: 0;
    font-size: 30px;
    font-weight: 800;
    letter-spacing: -0.8px;
    color: var(--ink);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .leaf {
    font-size: 26px;
    filter: drop-shadow(0 2px 4px rgba(16, 185, 129, 0.35));
  }
  .titles p {
    margin: 2px 0 0;
    font-size: 14.5px;
    font-weight: 600;
    color: var(--muted);
  }
  .header-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .install {
    border: 0;
    border-radius: 999px;
    padding: 9px 14px;
    font-size: 13px;
    font-weight: 800;
    font-family: inherit;
    color: #fff;
    background: var(--ink-soft);
    cursor: pointer;
  }
  .install:active {
    transform: scale(0.94);
  }
  .family-pill {
    font-size: 11.5px;
    font-weight: 800;
    letter-spacing: 0.3px;
    color: var(--accent);
    background: var(--accent-tint);
    border-radius: 999px;
    padding: 5px 11px;
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .switcher {
    border: 1.5px solid var(--card-border);
    background: var(--card);
    color: var(--ink);
    border-radius: 999px;
    padding: 6px 28px 6px 12px;
    font-size: 12.5px;
    font-weight: 800;
    font-family: inherit;
    cursor: pointer;
    max-width: 120px;
    appearance: none;
    -webkit-appearance: none;
    background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%),
      linear-gradient(135deg, var(--muted) 50%, transparent 50%);
    background-position: calc(100% - 14px) 55%, calc(100% - 10px) 55%;
    background-size: 4px 4px;
    background-repeat: no-repeat;
  }
  .logout {
    border: 0;
    background: var(--chip-bg);
    color: var(--muted);
    width: 30px;
    height: 30px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: transform 0.15s, background 0.15s;
  }
  .logout:active {
    transform: scale(0.9);
    background: var(--danger-tint);
    color: var(--danger);
  }

  .search-wrap {
    position: relative;
    display: flex;
    align-items: center;
    animation: fade-down 0.5s ease 0.06s both;
  }
  .search-ico {
    position: absolute;
    left: 15px;
    font-size: 15px;
    opacity: 0.85;
    pointer-events: none;
  }
  .search-wrap input {
    width: 100%;
    border: 1.5px solid var(--card-border);
    background: var(--card);
    color: var(--ink);
    border-radius: 16px;
    padding: 13px 42px;
    font-size: 16px;
    font-weight: 600;
    outline: none;
    box-shadow: var(--card-shadow);
    transition: border-color 0.15s, box-shadow 0.15s;
    font-family: inherit;
    -webkit-appearance: none;
  }
  .search-wrap input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 4px var(--focus-ring);
  }
  .search-wrap input::-webkit-search-cancel-button {
    display: none;
  }
  .clear {
    position: absolute;
    right: 10px;
    border: 0;
    background: var(--check-bg);
    color: var(--muted);
    width: 28px;
    height: 28px;
    border-radius: 9px;
    cursor: pointer;
    font-size: 12px;
    display: grid;
    place-items: center;
  }

  .chips {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 4px 2px 8px;
    scrollbar-width: none;
    animation: fade-down 0.5s ease 0.12s both;
  }
  .chips::-webkit-scrollbar {
    display: none;
  }
  .chip {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1.5px solid var(--card-border);
    background: var(--card);
    color: var(--ink);
    border-radius: 999px;
    padding: 9px 14px;
    font-size: 14px;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.18s cubic-bezier(0.34, 1.4, 0.64, 1);
    box-shadow: var(--card-shadow);
  }
  .chip b {
    background: var(--accent-tint);
    color: var(--accent);
    font-size: 11px;
    border-radius: 999px;
    padding: 1px 7px;
  }
  .chip.active {
    background: var(--accent-gradient);
    border-color: transparent;
    color: #fff;
    box-shadow: 0 6px 16px var(--accent-glow);
  }
  .chip.active b {
    background: rgba(255, 255, 255, 0.28);
    color: #fff;
  }
  .chip:active {
    transform: scale(0.94);
  }

  .shopping-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--accent-gradient);
    color: #fff;
    border-radius: 14px;
    padding: 11px 14px;
    font-size: 14px;
    font-weight: 800;
    box-shadow: 0 8px 20px var(--accent-glow);
    animation: fade-down 0.3s ease both;
  }
  .shop-icon {
    font-size: 17px;
  }
  .clear-tag {
    margin-left: auto;
    border: 0;
    background: rgba(255, 255, 255, 0.22);
    color: #fff;
    width: 24px;
    height: 24px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 11px;
    display: grid;
    place-items: center;
  }

  .clear-checked {
    align-self: flex-start;
    border: 0;
    background: var(--danger-tint);
    color: var(--danger);
    border-radius: 999px;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 800;
    font-family: inherit;
    cursor: pointer;
    animation: fade-down 0.3s ease both;
  }
  .clear-checked:active {
    transform: scale(0.95);
  }

  .list-wrap {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .groups {
    display: flex;
    flex-direction: column;
    gap: 18px;
    animation: fade-up 0.4s ease both;
  }
  .group {
    animation: fade-up 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
    animation-delay: var(--d, 0ms);
  }
  .group-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 6px 9px;
  }
  .g-icon {
    font-size: 15px;
  }
  .group-head h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.7px;
    text-transform: uppercase;
    color: var(--muted);
    flex: 1;
  }
  .count {
    font-size: 12px;
    font-weight: 800;
    color: var(--muted);
    background: var(--chip-bg);
    border-radius: 999px;
    padding: 2px 9px;
  }
  .items {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .empty {
    text-align: center;
    padding: 48px 20px 30px;
    animation: fade-up 0.45s ease both;
  }
  .empty-art {
    position: relative;
    width: 150px;
    height: 120px;
    margin: 0 auto 18px;
  }
  .e {
    position: absolute;
    font-size: 34px;
    filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.14));
    animation: bob 3.2s ease-in-out infinite;
  }
  .e1 {
    top: 6px;
    left: 6px;
  }
  .e2 {
    top: 0;
    right: 6px;
    animation-delay: -0.8s;
  }
  .e3 {
    bottom: 8px;
    left: 18px;
    animation-delay: -1.6s;
  }
  .e4 {
    bottom: 4px;
    right: 16px;
    animation-delay: -2.4s;
  }
  .basket {
    position: absolute;
    inset: 26px 30px auto auto;
    font-size: 74px;
    filter: drop-shadow(0 10px 16px rgba(0, 0, 0, 0.18));
  }
  @keyframes bob {
    0%,
    100% {
      transform: translateY(0) rotate(-3deg);
    }
    50% {
      transform: translateY(-9px) rotate(3deg);
    }
  }
  .empty h3 {
    margin: 0 0 6px;
    font-size: 19px;
    font-weight: 800;
    color: var(--ink);
  }
  .empty p {
    margin: 0 0 18px;
    font-size: 14.5px;
    color: var(--muted);
    font-weight: 600;
  }
  .cta {
    border: 0;
    border-radius: 999px;
    padding: 13px 22px;
    font-size: 15px;
    font-weight: 800;
    font-family: inherit;
    color: #fff;
    background: var(--accent-gradient);
    box-shadow: 0 8px 20px var(--accent-glow);
    cursor: pointer;
  }

  .fab {
    position: fixed;
    bottom: calc(26px + env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    z-index: 40;
    width: 62px;
    height: 62px;
    border-radius: 22px;
    border: 0;
    display: grid;
    place-items: center;
    color: #fff;
    background: var(--accent-gradient);
    box-shadow: 0 12px 30px var(--accent-glow);
    cursor: pointer;
    transition: transform 0.22s cubic-bezier(0.34, 1.6, 0.64, 1), box-shadow 0.2s;
  }
  .fab:active {
    transform: translateX(-50%) scale(0.9);
  }

  .fab-space {
    height: 8px;
  }

  .toast {
    position: fixed;
    bottom: calc(104px + env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--toast-bg);
    color: var(--toast-fg);
    border-radius: 999px;
    padding: 11px 18px;
    font-size: 14px;
    font-weight: 700;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    white-space: nowrap;
    animation: toast-in 0.3s cubic-bezier(0.34, 1.5, 0.64, 1) both;
    backdrop-filter: blur(8px);
  }
  @keyframes toast-in {
    from {
      transform: translate(-50%, 14px);
      opacity: 0;
    }
    to {
      transform: translate(-50%, 0);
      opacity: 1;
    }
  }

  .offline-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--warn-bg);
    color: var(--warn-fg);
    border-radius: 14px;
    padding: 11px 14px;
    font-size: 13.5px;
    font-weight: 700;
    box-shadow: var(--card-shadow);
    animation: fade-down 0.3s ease both;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--warn-fg);
    flex: none;
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }

  .skeleton {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .sk {
    height: 62px;
    border-radius: 18px;
    background: linear-gradient(100deg, var(--card) 40%, var(--skeleton-shine) 50%, var(--card) 60%);
    background-size: 200% 100%;
    animation: shimmer 1.3s linear infinite;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }

  @keyframes fade-down {
    from {
      transform: translateY(-10px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
  @keyframes fade-up {
    from {
      transform: translateY(12px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .blob,
    .e,
    .dot,
    .sk {
      animation: none;
    }
  }
</style>
