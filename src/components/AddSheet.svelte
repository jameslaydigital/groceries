<script>
  import { addItem, updateItem, removeItem, addTag, data, ui, categoryIcon, toast } from '../lib/store.svelte.js'
  import rpc from '../lib/rpc.js'

  let { open = $bindable(false) } = $props()
  let name = $state('')
  let quantity = $state('1')
  let category = $state('Produce')
  let notes = $state('')
  let selectedTags = $state([])
  let editingId = $state(null)
  let suggestions = $state([])
  let busy = $state(false)
  let input = $state(null)
  let addingTag = $state(false)
  let newTagName = $state('')
  let newTagIcon = $state('🛒')

  let categories = $derived(data.categories)
  let tags = $derived(data.tags)

  $effect(() => {
    if (ui.editing) {
      editingId = ui.editing.id
      name = ui.editing.name
      quantity = ui.editing.quantity
      category = ui.editing.category
      notes = ui.editing.notes ?? ''
      selectedTags = ui.editing.tag_ids ?? []
      suggestions = []
    }
  })

  $effect(() => {
    if (open && ui.editing === null && editingId === null) {
      name = ''
      quantity = '1'
      category = 'Produce'
      notes = ''
      selectedTags = []
    }
  })

  $effect(() => {
    if (open && input) input.focus()
  })

  $effect(() => {
    if (!open) {
      editingId = null
    }
  })

  $effect(() => {
    const q = name.trim()
    if (!q || editingId) {
      suggestions = []
      return
    }
    let live = true
    rpc('suggestions', q, 6)
      .then((rows) => {
        if (live) suggestions = rows.filter((r) => r.name.toLowerCase() !== q.toLowerCase())
      })
      .catch(() => {})
    return () => {
      live = false
    }
  })

  function pickSuggestion(s) {
    name = s.name
    quantity = s.quantity || '1'
    category = s.category
    notes = s.notes ?? ''
    selectedTags = s.tag_ids ?? []
    suggestions = []
  }

  async function forget(s) {
    try {
      await rpc('deleteHistoryItem', { name: s.name })
      suggestions = suggestions.filter((x) => x.name !== s.name)
      toast(`Forgot "${s.name}"`, '🗑️')
    } catch (e) {
      toast(e.message, '⚠️')
    }
  }

  async function addStore() {
    const n = newTagName.trim()
    if (!n || busy) return
    busy = true
    try {
      const tag = await addTag(n, newTagIcon)
      if (!selectedTags.includes(tag.id)) selectedTags = [...selectedTags, tag.id]
      newTagName = ''
      addingTag = false
    } catch (e) {
      toast(e.message, '⚠️')
    } finally {
      busy = false
    }
  }

  function toggleTag(id) {
    selectedTags = selectedTags.includes(id) ? selectedTags.filter((t) => t !== id) : [...selectedTags, id]
  }

  async function submit() {
    const n = name.trim()
    if (!n || busy) return
    busy = true
    if (editingId) {
      await updateItem(editingId, {
        name: n,
        quantity: quantity.trim() || '1',
        category,
        notes: notes.trim() || '',
        tag_ids: selectedTags,
      })
      ui.editing = null
      open = false
    } else {
      await addItem({ name: n, quantity: quantity.trim() || '1', category, notes: notes.trim() || '', tag_ids: selectedTags })
      name = ''
      quantity = '1'
      notes = ''
      input?.focus()
    }
    busy = false
  }

  function close() {
    ui.editing = null
    open = false
  }

  function onBackdrop(e) {
    if (e.target === e.currentTarget) close()
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

{#if open}
  <div class="overlay" onclick={onBackdrop} role="presentation">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Add item">
      <div class="grabber"></div>

      <div class="head">
        <h2>{editingId ? 'Edit item' : 'Add to list'}</h2>
        {#if editingId}
          <button class="cancel" type="button" onclick={close}>Done</button>
        {/if}
      </div>

      {#if suggestions.length && !editingId}
        <div class="suggestions">
          {#each suggestions as s (s.name)}
            <span class="chip-wrap">
              <button class="chip" onclick={() => pickSuggestion(s)}>
                <span>{categoryIcon(s.category)}</span>
                <span class="chip-name">{s.name}</span>
                <span class="chip-sub">{s.quantity}</span>
              </button>
              <button class="chip-del" onclick={() => forget(s)} aria-label={`Forget ${s.name}`}>✕</button>
            </span>
          {/each}
        </div>
      {/if}

      <label class="field">
        <span class="label">Item</span>
        <input
          bind:this={input}
          bind:value={name}
          placeholder="e.g. Avocados"
          autocomplete="off"
          onkeydown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && submit()}
        />
      </label>

      <label class="field">
        <span class="label">Qty</span>
        <input bind:value={quantity} placeholder="2" inputmode="text" autocomplete="off" />
      </label>

      <label class="field">
        <span class="label">Notes</span>
        <input bind:value={notes} placeholder="Aisle, price, brand… (optional)" autocomplete="off" />
      </label>

      <div class="field">
        <span class="label">Category</span>
        <div class="cat-grid">
          {#each categories as c (c.name)}
            <button class:active={category === c.name} onclick={() => (category = c.name)}>
              <span class="cat-icon">{c.icon}</span>
              <span class="cat-name">{c.name}</span>
            </button>
          {/each}
        </div>
      </div>

      {#if tags.length || addingTag}
        <div class="field">
          <span class="label">Stores</span>
          <div class="tag-row">
            {#each tags as t (t.id)}
              <button class:active={selectedTags.includes(t.id)} onclick={() => toggleTag(t.id)}>
                <span>{t.icon}</span> {t.name}
              </button>
            {/each}
            {#if addingTag}
              <span class="new-tag">
                <input
                  bind:value={newTagName}
                  placeholder="Store name"
                  autocomplete="off"
                  onkeydown={(e) => e.key === 'Enter' && addStore()}
                  onblur={() => {
                    if (!newTagName.trim()) addingTag = false
                  }}
                />
                <span class="icon-row">
                  {#each ['🛒', '🥑', '🏬', '🥩', '🧑‍🌾', '🍎'] as ico (ico)}
                    <button class:active={newTagIcon === ico} onclick={() => (newTagIcon = ico)} aria-label={`Icon ${ico}`}>{ico}</button>
                  {/each}
                </span>
                <button class="new-tag-add" onclick={addStore} disabled={!newTagName.trim() || busy}>Add</button>
              </span>
            {:else}
              <button class="tag-add" onclick={() => (addingTag = true)}>+ Store</button>
            {/if}
          </div>
        </div>
      {/if}

      {#if editingId}
        <button class="delete" onclick={() => { removeItem(editingId); close() }}>Delete item</button>
      {/if}

      <button class="submit" class:busy onclick={submit} disabled={!name.trim() || busy}>
        {#if busy}
          <span class="spin"></span>
        {:else}
          {editingId ? 'Save changes' : 'Add item'}
        {/if}
      </button>
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
  .cancel {
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
  .field {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-bottom: 16px;
  }
  .label {
    font-size: 12.5px;
    font-weight: 800;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--muted);
  }
  input {
    border: 1.5px solid var(--input-border);
    background: var(--input-bg);
    color: var(--ink);
    border-radius: 14px;
    padding: 13px 15px;
    font-size: 17px;
    font-weight: 600;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
    font-family: inherit;
  }
  input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 4px var(--focus-ring);
  }
  .cat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
    gap: 8px;
  }
  .cat-grid button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 6px;
    border-radius: 14px;
    border: 1.5px solid var(--input-border);
    background: var(--input-bg);
    cursor: pointer;
    transition: all 0.18s;
    font-family: inherit;
  }
  .cat-grid button.active {
    border-color: var(--accent);
    background: var(--accent-tint);
    box-shadow: 0 0 0 4px var(--focus-ring);
  }
  .cat-grid button:active {
    transform: scale(0.95);
  }
  .cat-icon {
    font-size: 22px;
  }
  .cat-name {
    font-size: 11.5px;
    font-weight: 700;
    color: var(--ink);
    text-align: center;
    line-height: 1.1;
  }
  .tag-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .tag-row button {
    border: 1.5px solid var(--input-border);
    background: var(--input-bg);
    color: var(--ink);
    border-radius: 999px;
    padding: 9px 14px;
    font-size: 14px;
    font-weight: 700;
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    transition: all 0.18s;
  }
  .tag-row button.active {
    border-color: var(--accent);
    background: var(--accent-tint);
    color: var(--accent);
    box-shadow: 0 0 0 4px var(--focus-ring);
  }
  .tag-row button:active {
    transform: scale(0.95);
  }
  .tag-add {
    border: 1.5px dashed var(--input-border);
    background: transparent;
    color: var(--muted);
    border-radius: 999px;
    padding: 9px 14px;
    font-size: 14px;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.18s;
  }
  .tag-add:active {
    transform: scale(0.95);
    color: var(--accent);
    border-color: var(--accent);
  }
  .new-tag {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    padding: 10px;
    border: 1.5px dashed var(--input-border);
    border-radius: 14px;
    background: var(--input-bg);
  }
  .new-tag input {
    border: 1.5px solid var(--input-border);
    background: var(--card);
    color: var(--ink);
    border-radius: 12px;
    padding: 10px 12px;
    font-size: 15px;
    font-weight: 600;
    outline: none;
    font-family: inherit;
  }
  .new-tag input:focus {
    border-color: var(--accent);
  }
  .icon-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .icon-row button {
    border: 1.5px solid var(--input-border);
    background: var(--card);
    border-radius: 10px;
    padding: 5px 8px;
    font-size: 16px;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.15s;
  }
  .icon-row button.active {
    border-color: var(--accent);
    background: var(--accent-tint);
  }
  .new-tag-add {
    align-self: flex-end;
    border: 0;
    border-radius: 12px;
    padding: 9px 16px;
    font-size: 14px;
    font-weight: 800;
    color: #fff;
    font-family: inherit;
    background: var(--accent-gradient);
    cursor: pointer;
  }
  .new-tag-add:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .delete {
    width: 100%;
    margin-top: 10px;
    padding: 13px;
    border: 0;
    border-radius: 14px;
    font-size: 15px;
    font-weight: 800;
    font-family: inherit;
    color: var(--danger);
    background: var(--danger-tint);
    cursor: pointer;
    transition: transform 0.15s;
  }
  .delete:active {
    transform: scale(0.97);
  }
  .suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 14px;
  }
  .chip-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .chip {
    border: 1.5px solid var(--input-border);
    background: var(--input-bg);
    color: var(--ink);
    border-radius: 999px;
    padding: 8px 30px 8px 14px;
    font-size: 14px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    transition: all 0.15s;
    font-family: inherit;
  }
  .chip:active {
    background: var(--accent-tint);
    transform: scale(0.96);
  }
  .chip-name {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip-sub {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--muted);
  }
  .chip-del {
    position: absolute;
    right: 3px;
    top: 50%;
    transform: translateY(-50%);
    border: 0;
    background: transparent;
    color: var(--muted);
    width: 22px;
    height: 22px;
    border-radius: 50%;
    font-size: 10px;
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: background 0.15s, color 0.15s;
  }
  .chip-del:active {
    background: var(--danger-tint);
    color: var(--danger);
  }
  .submit {
    width: 100%;
    margin-top: 6px;
    padding: 16px;
    border: 0;
    border-radius: 16px;
    font-size: 17px;
    font-weight: 800;
    color: #fff;
    font-family: inherit;
    background: var(--accent-gradient);
    box-shadow: 0 8px 22px var(--accent-glow);
    cursor: pointer;
    transition: transform 0.15s, opacity 0.15s, box-shadow 0.15s;
  }
  .submit:active:not(:disabled) {
    transform: scale(0.97);
  }
  .submit:disabled {
    opacity: 0.55;
    box-shadow: none;
  }
  .submit.busy {
    opacity: 0.85;
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
