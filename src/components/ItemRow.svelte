<script>
  import { toggleItem, removeItem, ui, tagsById } from '../lib/store.svelte.js'

  let { item } = $props()
  let tagMap = $derived(tagsById())
  let badges = $derived((item.tag_ids ?? []).map((id) => tagMap.get(id)).filter(Boolean).slice(0, 2))

  let startX = 0
  let dragging = $state(false)
  let offset = $state(0)
  let suppressClick = false

  const THRESHOLD = -76

  function onStart(e) {
    startX = e.touches ? e.touches[0].clientX : e.clientX
    dragging = true
  }
  function onMove(e) {
    if (!dragging) return
    const x = e.touches ? e.touches[0].clientX : e.clientX
    const d = x - startX
    offset = Math.max(-120, Math.min(0, d))
  }
  function onEnd() {
    dragging = false
    if (offset < THRESHOLD) {
      offset = -96
      suppressClick = true
      setTimeout(() => (suppressClick = false), 350)
    } else {
      offset = 0
    }
  }
  function onDelete() {
    removeItem(item.id)
  }
  function onEdit() {
    if (suppressClick) return
    ui.editing = item
  }
</script>

  <div
    class="swipe-wrap"
    role="presentation"
    style="--off: {offset}px"
    ontouchstart={onStart}
    ontouchmove={onMove}
    ontouchend={onEnd}
    onmousedown={onStart}
    onmousemove={onMove}
    onmouseup={onEnd}
    onmouseleave={onEnd}
  >
  <div class="row-bg">
    <button class="del" onclick={onDelete} aria-label="Delete {item.name}">✕</button>
    <button class="edit-btn" onclick={onEdit} aria-label="Edit {item.name}">✎</button>
  </div>

  <div class="row" class:done={item.checked} style:transition={dragging ? 'none' : undefined}>
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
      </div>
      {#if badges.length}
        <span class="badges" aria-label="Stores">
          {#each badges as b (b.id)}
            <span class="badge" title={b.name}>{b.icon}</span>
          {/each}
        </span>
      {/if}
    </button>
  </div>
</div>

<style>
  .swipe-wrap {
    position: relative;
    border-radius: 18px;
    overflow: hidden;
    touch-action: pan-y;
  }
  .row {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 14px;
    background: var(--card);
    border: 1px solid var(--card-border);
    border-radius: 18px;
    box-shadow: var(--card-shadow);
    transition: translate 0.35s cubic-bezier(0.32, 1.4, 0.55, 1), background 0.25s, opacity 0.25s;
    translate: var(--off);
  }
  .row-bg {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding-right: 10px;
    background: linear-gradient(135deg, #f43f5e, #e11d48);
    border-radius: 18px;
  }
  .del,
  .edit-btn {
    border: 0;
    background: transparent;
    color: #fff;
    font-size: 18px;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: background 0.15s, transform 0.15s;
  }
  .del:active,
  .edit-btn:active {
    background: rgba(255, 255, 255, 0.22);
    transform: scale(0.9);
  }
  .edit-btn {
    font-size: 16px;
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
