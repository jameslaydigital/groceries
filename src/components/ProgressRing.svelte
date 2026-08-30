<script>
  let { total = 0, done = 0 } = $props()
  const R = 26
  const CIRC = 2 * Math.PI * R
  let pct = $derived(total === 0 ? 0 : done / total)
  let allDone = $derived(total > 0 && done === total)
</script>

<div class="ring" class:all-done={allDone} aria-label={`${done} of ${total} done`}>
  <svg viewBox="0 0 64 64" width="64" height="64">
    <circle class="track" cx="32" cy="32" r={R} />
    <circle
      class="bar"
      cx="32"
      cy="32"
      r={R}
      stroke-dasharray={CIRC}
      stroke-dashoffset={CIRC * (1 - pct)}
      stroke-linecap="round"
    />
  </svg>
  <div class="inner">
    {#if allDone}
      <span class="pop">✓</span>
    {:else}
      <strong>{done}</strong>
      <span class="of">/{total}</span>
    {/if}
  </div>
</div>

<style>
  .ring {
    position: relative;
    width: 64px;
    height: 64px;
    flex: none;
  }
  svg {
    display: block;
    transform: rotate(-90deg);
  }
  .track {
    fill: none;
    stroke: var(--ring-track);
    stroke-width: 6;
  }
  .bar {
    fill: none;
    stroke: var(--ring-fg);
    stroke-width: 6;
    transition: stroke-dashoffset 0.55s cubic-bezier(0.34, 1.4, 0.64, 1);
  }
  .inner {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: baseline;
    justify-content: center;
    flex-direction: row;
    color: var(--text);
  }
  .inner strong {
    font-size: 15px;
    font-weight: 800;
    line-height: 64px;
    color: var(--ink);
  }
  .of {
    font-size: 10px;
    font-weight: 700;
    color: var(--muted);
    line-height: 64px;
  }
  .pop {
    font-size: 22px;
    line-height: 64px;
    color: var(--accent);
    animation: pop 0.4s cubic-bezier(0.34, 1.8, 0.64, 1);
  }
  .all-done .bar {
    stroke: var(--accent);
  }
  @keyframes pop {
    0% {
      transform: scale(0.3);
      opacity: 0;
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }
</style>
