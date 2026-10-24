<script>
  import { toggleItem, removeItem, ui, tagsById, user } from '../lib/store.svelte.js'

  let { item } = $props()
  let tagMap = $derived(tagsById())
  let badges = $derived((item.tag_ids ?? []).map((id) => tagMap.get(id)).filter(Boolean).slice(0, 2))
  // Only credit the checker when it wasn't us — you already know you got it.
  let credited = $derived(
    item.checked && item.checked_by?.id && item.checked_by.id !== user.id && item.checked_by.name
  )

  let popping = $state(false)
  let popTimer

  function onCheck() {
    // Brief ring only for a local check-off, not for pre-checked rows on load.
    if (!item.checked) {
      popping = true
      clearTimeout(popTimer)
      popTimer = setTimeout(() => (popping = false), 450)
    }
    toggleItem(item)
  }

  function onDelete() {
    removeItem(item)
  }
  function onEdit() {
    ui.editing = item
  }
</script>

<div class="row" class:done={item.checked}>
  <button
    class="check"
    class:done={item.checked}
    class:pop={popping}
    onclick={onCheck}
    aria-label="Toggle {item.name}"
  >
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path pathLength="1" d="M4.5 12.5l5 5L19.5 6.5" />
    </svg>
  </button>

  <button type="button" class="body" onclick={onEdit}>
    <span class="icon">{item.category_icon ?? '🛒'}</span>
    <div class="texts">
      <span class="name">{item.name}</span>
      <span class="qty" class:done={item.checked}>{item.quantity}</span>
      {#if item.notes}
        <span class="note">{item.notes}</span>
      {/if}
      {#if credited}
        <span class="credit">✓ {credited}</span>
      {/if}
    </div>
    {#if badges.length}
      <span class="badges" aria-label="Stores">
        {#each badges as b (b.id)}
          <span class="badge" title={b.name}>{b.icon}</span>
        {/each}
      </span>
    {/if}
  </button>

  <button class="delete" onclick={onDelete} aria-label={`Delete ${item.name}`} title="Delete">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14" />
    </svg>
  </button>
</div>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 2px;
  }

  .check {
    position: relative;
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 2px solid var(--check-border);
    background: var(--check-bg);
    display: grid;
    place-items: center;
    color: transparent;
    cursor: pointer;
    transition:
      border-color 0.2s ease,
      background 0.2s ease,
      color 0.18s ease,
      box-shadow 0.2s ease,
      transform 0.16s cubic-bezier(0.34, 1.6, 0.64, 1);
    -webkit-tap-highlight-color: transparent;
  }
  /* The gradient fill fades in under the stroke instead of snapping on. */
  .check::before {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: 50%;
    background: var(--accent-gradient);
    opacity: 0;
    transform: scale(0.9);
    transition:
      opacity 0.18s ease,
      transform 0.24s cubic-bezier(0.34, 1.6, 0.64, 1);
  }
  .check svg {
    position: relative;
    z-index: 1;
  }
  .check svg path {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    transition: stroke-dashoffset 0.22s ease 0.04s;
  }
  .check.done {
    border-color: transparent;
    color: #fff;
    box-shadow: 0 4px 12px var(--accent-glow);
  }
  .check.done::before {
    opacity: 1;
    transform: scale(1);
  }
  .check.done svg path {
    stroke-dashoffset: 0;
  }
  .check:active {
    transform: scale(0.9);
  }
  .check.done:active {
    transform: scale(0.94);
  }
  /* Quiet ring that expands once when this device checks the row. */
  .check.pop::after {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: 50%;
    border: 2px solid var(--accent);
    opacity: 0;
    animation: check-ring 0.42s ease-out;
  }
  @keyframes check-ring {
    0% {
      opacity: 0.35;
      transform: scale(1);
    }
    100% {
      opacity: 0;
      transform: scale(1.55);
    }
  }

  .body {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 1;
    cursor: pointer;
    border: 0;
    background: transparent;
    padding: 0;
    text-align: left;
    font: inherit;
    color: inherit;
  }
  .icon {
    font-size: 24px;
    filter: saturate(1.05);
  }
  .texts {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .name {
    font-size: 17px;
    font-weight: 700;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 0.25s;
  }
  .qty {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--accent-soft);
    transition: color 0.25s;
  }
  .note {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .credit {
    font-size: 12px;
    font-weight: 700;
    color: var(--accent-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row.done .credit {
    color: var(--muted);
  }
  .badges {
    display: inline-flex;
    gap: 3px;
    margin-left: auto;
    flex: none;
  }
  .badge {
    width: 24px;
    height: 24px;
    border-radius: 8px;
    background: var(--chip-bg);
    display: grid;
    place-items: center;
    font-size: 13px;
  }
  .delete {
    flex: none;
    border: 0;
    background: transparent;
    color: var(--muted);
    width: 30px;
    height: 30px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, transform 0.15s;
  }
  .delete:active {
    background: var(--danger-tint);
    color: var(--danger);
    transform: scale(0.9);
  }

  .row.done {
    opacity: 0.72;
  }
  .row.done .name {
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-color: var(--muted);
    text-decoration-thickness: 1.5px;
  }
  .row.done .qty {
    color: var(--muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .check,
    .check::before,
    .check svg path {
      transition: none;
    }
    .check.pop::after {
      animation: none;
    }
  }
</style>
