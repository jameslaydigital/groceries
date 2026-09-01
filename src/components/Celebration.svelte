<script>
  let { show = false } = $props()

  const COLORS = ['#f43f5e', '#fb923c', '#facc15', '#34d399', '#38bdf8', '#a78bfa', '#f472b6']

  let particles = $state([])

  $effect(() => {
    if (show) {
      particles = Array.from({ length: 42 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        color: COLORS[i % COLORS.length],
        size: 6 + Math.random() * 7,
        delay: Math.random() * 0.4,
        duration: 1.6 + Math.random() * 1.4,
        spin: (Math.random() - 0.5) * 1080,
      }))
    } else {
      particles = []
    }
  })
</script>

{#if show}
  <div class="confetti" aria-hidden="true">
    {#each particles as p (p.id)}
      <span
        class="particle"
        style="left:{p.left}%;width:{p.size}px;height:{p.size * 0.4}px;background:{p.color};animation-delay:{p.delay}s;animation-duration:{p.duration}s;--spin:{p.spin}deg"
      ></span>
    {/each}
    <div class="flash">🎉 All done!</div>
  </div>
{/if}

<style>
  .confetti {
    position: fixed;
    inset: 0;
    z-index: 90;
    pointer-events: none;
    overflow: hidden;
  }
  .particle {
    position: absolute;
    top: -20px;
    border-radius: 2px;
    animation-name: fall;
    animation-timing-function: cubic-bezier(0.25, 0.46, 0.45, 0.94);
    animation-fill-mode: both;
  }
  @keyframes fall {
    0% {
      transform: translateY(0) rotate(0deg);
      opacity: 1;
    }
    100% {
      transform: translateY(110vh) rotate(var(--spin, 360deg));
      opacity: 0.9;
    }
  }
  .flash {
    position: absolute;
    left: 50%;
    top: 40%;
    transform: translate(-50%, -50%);
    font-size: 30px;
    font-weight: 800;
    color: var(--toast-fg);
    background: var(--toast-bg);
    padding: 14px 22px;
    border-radius: 999px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    white-space: nowrap;
    animation: pop 0.5s cubic-bezier(0.34, 1.8, 0.64, 1) both;
  }
  @keyframes pop {
    from {
      transform: translate(-50%, -50%) scale(0.5);
      opacity: 0;
    }
    to {
      transform: translate(-50%, -50%) scale(1);
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .particle {
      animation: none;
      display: none;
    }
    .flash {
      animation: none;
    }
  }
</style>
