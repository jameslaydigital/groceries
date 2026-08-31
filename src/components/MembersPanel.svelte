<script>
  import { members, user, family, invite, revokeInvite, listMembers, generateResetLink, toast } from '../lib/store.svelte.js'

  let { open = $bindable(false) } = $props()
  let email = $state('')
  let error = $state('')
  let busy = $state(false)
  let copiedId = $state(null)
  let resetFor = $state(null)
  let resetBusy = $state(null)
  let copiedReset = $state(false)

  const isAdmin = $derived(user.role === 'admin')

  $effect(() => {
    if (open) {
      error = ''
      email = ''
      resetFor = null
      listMembers().catch((e) => toast(e.message, '⚠️'))
    }
  })

  let familyUrl = $derived.by(() => {
    if (typeof window === 'undefined' || !family.subdomain) return ''
    const host = window.location.hostname
    const port = window.location.port ? `:${window.location.port}` : ''
    let newHost
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.lvh.me')) {
      newHost = `${family.subdomain}.lvh.me`
    } else {
      const labels = host.split('.')
      newHost = labels.length > 2 ? `${family.subdomain}.${labels.slice(1).join('.')}` : `${family.subdomain}.${host}`
    }
    return `${window.location.protocol}//${newHost}${port}${window.location.pathname}`
  })

  function inviteLink(token) {
    return `${familyUrl}/invite/accept/${token}`
  }

  async function submit() {
    if (busy) return
    const addr = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      error = 'Enter a valid email address'
      return
    }
    error = ''
    busy = true
    try {
      await invite(addr)
      toast('Invite created — copy the link below', '🔗')
      email = ''
    } catch (e) {
      error = e.message || 'Something went wrong'
    } finally {
      busy = false
    }
  }

  async function revoke(id) {
    try {
      await revokeInvite(id)
      toast('Invite revoked', '🗑️')
    } catch (e) {
      toast(e.message, '⚠️')
    }
  }

  async function copyLink(token) {
    try {
      await navigator.clipboard.writeText(inviteLink(token))
      copiedId = token
      setTimeout(() => (copiedId = null), 1600)
    } catch {
      /* clipboard unavailable */
    }
  }

  async function resetPw(member) {
    if (resetBusy) return
    resetBusy = member.id
    try {
      const { token, email } = await generateResetLink(member.id)
      resetFor = { id: member.id, email, url: `${familyUrl}/reset/${token}` }
      resetBusy = null
    } catch (e) {
      resetBusy = null
      toast(e.message, '⚠️')
    }
  }

  async function copyReset() {
    if (!resetFor) return
    try {
      await navigator.clipboard.writeText(resetFor.url)
      copiedReset = true
      setTimeout(() => (copiedReset = false), 1600)
    } catch {
      /* clipboard unavailable */
    }
  }

  function close() {
    open = false
  }

  function onBackdrop(e) {
    if (e.target === e.currentTarget) close()
  }

  function initialOf(m) {
    const name = m.display_name?.trim()
    return (name || m.email)[0]?.toUpperCase() ?? '?'
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

{#if open}
  <div class="overlay" onclick={onBackdrop} role="presentation">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Members">
      <div class="grabber"></div>

      <div class="head">
        <h2>Members</h2>
        <button class="done" type="button" onclick={close}>Done</button>
      </div>

      {#if isAdmin}
        <form onsubmit={(e) => { e.preventDefault(); submit() }} class="invite-form">
          <input
            bind:value={email}
            type="email"
            placeholder="friend@example.com"
            aria-label="Email to invite"
            autocomplete="off"
          />
          <button class="send" disabled={!email.trim() || busy}>
            {#if busy}
              <span class="spin"></span>
            {:else}
              Invite
            {/if}
          </button>
        </form>
        {#if error}
          <div class="error">⚠️ {error}</div>
        {/if}
        <p class="hint">Invites are links, not emails — copy the link next to a pending invite and send it however you like.</p>

        <div class="section">
          <div class="section-head">
            <h3>Pending invites</h3>
            <span class="count">{members.invites.length}</span>
          </div>
          {#if members.invites.length === 0}
            <p class="empty">Nothing pending — invite someone above.</p>
          {:else}
            <ul class="roster">
              {#each members.invites as inv (inv.id)}
                <li>
                  <span class="avatar pending">⏳</span>
                  <span class="who">
                    <span class="name">{inv.email}</span>
                    <span class="email">Not signed up yet</span>
                  </span>
                  {#if inv.token}
                    <button class="copy" onclick={() => copyLink(inv.token)} aria-label={`Copy invite link for ${inv.email}`}>
                      {copiedId === inv.token ? '✓' : 'Copy'}
                    </button>
                  {/if}
                  <button class="revoke" onclick={() => revoke(inv.id)} aria-label={`Revoke invite for ${inv.email}`}>
                    ✕
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      <div class="section">
        <div class="section-head">
          <h3>In the family</h3>
          <span class="count">{members.list.length}</span>
        </div>
        {#if members.list.length === 0}
          <p class="empty">No members yet.</p>
        {:else}
          <ul class="roster">
            {#each members.list as m (m.id)}
              <li>
                <span class="avatar">{initialOf(m)}</span>
                <span class="who">
                  <span class="name">
                    {m.display_name || m.email}
                    {#if m.role === 'admin'}<span class="badge">admin</span>{/if}
                  </span>
                  <span class="email">{m.email}</span>
                </span>
                {#if isAdmin}
                  <button class="key" onclick={() => resetPw(m)} disabled={resetBusy !== null} aria-label={`Generate reset link for ${m.email}`} title="Reset password">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="7.5" cy="15.5" r="3.5" />
                      <path d="M10 13 21 2M15.5 6.5l2.5 2.5M12 10l2 2" />
                    </svg>
                  </button>
                {/if}
              </li>
              {#if resetFor?.id === m.id}
                <li class="reset-row">
                  <span class="who">
                    <span class="name">Reset link for {m.display_name || m.email}</span>
                    <span class="email link-url">{resetFor.url}</span>
                    <span class="email">Single-use, expires in 24h</span>
                  </span>
                  <button class="copy" onclick={copyReset} aria-label="Copy reset link">
                    {copiedReset ? '✓' : 'Copy'}
                  </button>
                  <button class="revoke" onclick={() => (resetFor = null)} aria-label="Dismiss reset link">✕</button>
                </li>
              {/if}
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: var(--scrim);
    backdrop-filter: blur(8px) saturate(1.1);
    -webkit-backdrop-filter: blur(8px) saturate(1.1);
    animation: fade 0.22s ease;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
  .sheet {
    width: min(100%, 520px);
    max-height: 88svh;
    overflow-y: auto;
    background: var(--sheet);
    border-radius: 26px 26px 0 0;
    padding: 10px 22px calc(22px + env(safe-area-inset-bottom));
    box-shadow: 0 -10px 50px rgba(0, 0, 0, 0.18);
    animation: rise 0.34s cubic-bezier(0.22, 1.2, 0.36, 1);
  }
  .grabber {
    width: 44px;
    height: 5px;
    border-radius: 99px;
    background: var(--grabber);
    margin: 0 auto 14px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  h2 {
    margin: 0;
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.4px;
    color: var(--ink);
  }
  .done {
    border: 0;
    background: transparent;
    font-family: inherit;
    color: var(--accent);
    font-weight: 700;
    font-size: 15px;
    padding: 6px 10px;
    border-radius: 10px;
    cursor: pointer;
  }

  .invite-form {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
  }
  .invite-form input {
    flex: 1;
    min-width: 0;
    border: 1.5px solid var(--input-border);
    background: var(--input-bg);
    color: var(--ink);
    border-radius: 14px;
    padding: 12px 14px;
    font-size: 16px;
    font-weight: 600;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
    font-family: inherit;
  }
  .invite-form input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 4px var(--focus-ring);
  }
  .send {
    flex: none;
    border: 0;
    border-radius: 14px;
    padding: 0 18px;
    font-size: 15px;
    font-weight: 800;
    color: #fff;
    font-family: inherit;
    background: var(--accent-gradient);
    box-shadow: 0 6px 18px var(--accent-glow);
    cursor: pointer;
    transition: transform 0.15s, opacity 0.15s;
  }
  .send:active:not(:disabled) {
    transform: scale(0.96);
  }
  .send:disabled {
    opacity: 0.55;
    box-shadow: none;
  }
  .error {
    font-size: 13px;
    font-weight: 700;
    color: var(--danger);
    background: var(--danger-tint);
    border-radius: 12px;
    padding: 9px 12px;
    margin-bottom: 12px;
  }
  .hint {
    margin: -2px 0 12px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
    line-height: 1.45;
  }

  .section {
    margin-top: 18px;
  }
  .section-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 9px;
  }
  .section-head h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.7px;
    text-transform: uppercase;
    color: var(--muted);
  }
  .count {
    font-size: 11px;
    font-weight: 800;
    color: var(--muted);
    background: var(--chip-bg);
    border-radius: 999px;
    padding: 2px 9px;
  }
  .empty {
    margin: 0;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--muted);
    padding: 4px 2px;
  }
  .roster {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .roster li {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--input-bg);
    border: 1.5px solid var(--input-border);
    border-radius: 14px;
    padding: 10px 12px;
  }
  .avatar {
    flex: none;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 16px;
    font-weight: 800;
    color: #fff;
    background: var(--accent-gradient);
    box-shadow: 0 4px 10px var(--accent-glow);
  }
  .avatar.pending {
    background: var(--chip-bg);
    color: var(--muted);
    box-shadow: none;
  }
  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .name {
    font-size: 14.5px;
    font-weight: 700;
    color: var(--ink);
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    flex: none;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: var(--accent);
    background: var(--accent-tint);
    border-radius: 999px;
    padding: 2px 7px;
  }
  .email {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .copy {
    flex: none;
    border: 0;
    background: var(--accent-tint);
    color: var(--accent);
    font-family: inherit;
    font-weight: 800;
    font-size: 11.5px;
    padding: 5px 10px;
    border-radius: 9px;
    cursor: pointer;
  }
  .copy:active {
    transform: scale(0.94);
  }
  .key {
    flex: none;
    border: 0;
    width: 26px;
    height: 26px;
    border-radius: 9px;
    background: var(--chip-bg);
    color: var(--muted);
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .key:active:not(:disabled) {
    transform: scale(0.9);
  }
  .key:disabled {
    opacity: 0.5;
  }
  .revoke {
    flex: none;
    border: 0;
    width: 26px;
    height: 26px;
    border-radius: 9px;
    background: var(--danger-tint);
    color: var(--danger);
    font-size: 11px;
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .revoke:active {
    transform: scale(0.9);
  }
  .roster .reset-row {
    border: 1.5px dashed var(--input-border);
    background: var(--accent-tint);
  }
  .link-url {
    word-break: break-all;
  }

  .spin {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 3px solid rgba(255, 255, 255, 0.35);
    border-top-color: #fff;
    display: inline-block;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes rise {
    from {
      transform: translateY(60px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
</style>
