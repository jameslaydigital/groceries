<script>
  import { toggleItem, removeItem, ui, tagsById } from '../lib/store.svelte.js'

  let { item } = $props()
  let tagMap = $derived(tagsById())
  let badges = $derived((item.tag_ids ?? []).map((id) => tagMap.get(id)).filter(Boolean).slice(0, 2))

  function onDelete() {
    removeItem(item)
  }
  function onEdit() {
    ui.editing = item
  }
</script>

<div class="row" class:done={item.checked}>
  <button class="check" class:done={item.checked} onclick={() => toggleItem(item)} aria-label="Toggle {item.name}">
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 12.5l5 5L20 6.5" />
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
  .row:not(:last-child)::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -3px;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--card-border) 12%, var(--card-border) 88%, transparent);
  }
  .row:last-child {
    padding-bottom: 2px;
  }

  .check {
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 10px;
    border: 2px solid var(--check-border);
    background: var(--check-bg);
    display: grid;
    place-items: center;
    color: transparent;
    cursor: pointer;
    transition: all 0.22s cubic-bezier(0.34, 1.6, 0.64, 1);
    -webkit-tap-highlight-color: transparent;
  }
  .check svg {
    transform: scale(0.4);
    transition: transform 0.25s cubic-bezier(0.34, 1.8, 0.64, 1);
  }
  .check.done {
    background: var(--accent-gradient);
    border-color: transparent;
    color: #fff;
    box-shadow: 0 4px 12px var(--accent-glow);
  }
  .check.done svg {
    transform: scale(1);
  }
  .check:active {
    transform: scale(0.88);
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
</style>
