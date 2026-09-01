<script>
  import { resetPassword } from '../lib/store.svelte.js'
  import rpc from '../lib/rpc.js'

  let { token = '' } = $props()
  let info = $state(null)
  let error = $state('')
  let password = $state('')
  let busy = $state(false)
  let done = $state(false)
  let checked = $state(false)
  let passField = $state(null)

  $effect(() => {
    if (!checked && token) {
      checked = true
      rpc('auth.resetPasswordInfo', { token })
        .then((res) => {
          if (res?.valid) info = res
          else error = 'This reset link is invalid or has expired.'
        })
        .catch((e) => {
          error = e.message || 'Could not check this link'
        })
    }
  })

  $effect(() => {
    if (info && passField) passField.focus()
  })

  async function submit() {
    if (busy) return
    error = ''
    if (password.length < 8) {
      error = 'Password must be at least 8 characters'
      return
    }
    busy = true
    try {
      await resetPassword(token, password)
      done = true
    } catch (e) {
      error = e.message || 'Something went wrong'
      busy = false
    }
  }

  function goHome() {
    window.location.pathname = '/'
  }
</script>

<div class="auth">
  <div class="blobs" aria-hidden="true">
    <span class="blob b1"></span>
    <span class="blob b2"></span>
    <span class="blob b3"></span>
  </div>

  <div class="card">
    <div class="brand">
      <img class="logo" src="/icons/logo.webp" alt="Syncart" />
      <h1>Reset your password</h1>
      {#if info}
        <p class="family">{info.email}</p>
        <p class="hint">Choose a new password for your Syncart account.</p>
      {:else if !error}
        <p class="family">Checking your link…</p>
      {/if}
    </div>

    {#if done}
      <div class="success">✓ Password updated</div>
      <button class="submit" onclick={goHome}>Log in</button>
    {:else if error && !info}
      <div class="error">⚠️ {error}</div>
    {:else if info}
      <form onsubmit={(e) => { e.preventDefault(); submit() }}>
        <label class="field">
          <span>New password</span>
          <input
            bind:this={passField}
            bind:value={password}
            type="password"
            placeholder="At least 8 characters"
            autocomplete="new-password"
          />
        </label>

        {#if error}
          <div class="error">⚠️ {error}</div>
        {/if}

        <button class="submit" disabled={busy}>
          {#if busy}
            <span class="spin"></span>
          {:else}
            Update password
          {/if}
        </button>
      </form>
    {/if}
  </div>
</div>

<style>
  .auth {
    min-height: 100svh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 20px calc(40px + env(safe-area-inset-bottom));
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

  .card {
    width: min(100%, 400px);
    background: var(--sheet);
    border: 1px solid var(--card-border);
    border-radius: 28px;
    padding: 30px 26px 24px;
    box-shadow: var(--card-shadow);
    animation: rise 0.45s cubic-bezier(0.22, 1.2, 0.36, 1) both;
  }
  .brand {
    text-align: center;
    margin-bottom: 22px;
  }
  .logo {
    width: 84px;
    height: 84px;
    margin: 0 auto;
    display: block;
    filter: drop-shadow(0 4px 8px rgba(16, 185, 129, 0.35));
  }
  @media (prefers-color-scheme: dark) {
    .logo {
      filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.4)) brightness(1.15);
    }
  }
  h1 {
    margin: 6px 0 0;
    font-size: 24px;
    font-weight: 800;
    letter-spacing: -0.6px;
    color: var(--ink);
  }
  .family {
    margin: 6px 0 0;
    font-size: 14px;
    font-weight: 700;
    color: var(--accent);
  }
  .hint {
    margin: 6px 0 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    line-height: 1.5;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 13px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field span {
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--muted);
  }
  input {
    border: 1.5px solid var(--input-border);
    background: var(--input-bg);
    color: var(--ink);
    border-radius: 14px;
    padding: 13px 15px;
    font-size: 16px;
    font-weight: 600;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
    font-family: inherit;
  }
  input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 4px var(--focus-ring);
  }
  .error {
    font-size: 13.5px;
    font-weight: 700;
    color: var(--danger);
    background: var(--danger-tint);
    border-radius: 12px;
    padding: 10px 12px;
    animation: fade-down 0.25s ease both;
  }
  .success {
    font-size: 14px;
    font-weight: 700;
    color: var(--accent);
    background: var(--accent-tint);
    border-radius: 12px;
    padding: 12px;
    text-align: center;
    margin-bottom: 12px;
  }
  .submit {
    width: 100%;
    border: 0;
    border-radius: 15px;
    padding: 15px;
    font-size: 16px;
    font-weight: 800;
    font-family: inherit;
    color: #fff;
    background: var(--accent-gradient);
    box-shadow: 0 8px 22px var(--accent-glow);
    cursor: pointer;
    transition: transform 0.15s, opacity 0.15s;
  }
  .submit:active:not(:disabled) {
    transform: scale(0.97);
  }
  .submit:disabled {
    opacity: 0.7;
    cursor: default;
  }
  .spin {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 3px solid rgba(255, 255, 255, 0.35);
    border-top-color: #fff;
    display: inline-block;
    animation: spin 0.7s linear infinite;
  }

  @keyframes rise {
    from {
      transform: translateY(18px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
  @keyframes fade-down {
    from {
      transform: translateY(-6px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
