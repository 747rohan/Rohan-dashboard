<script setup>
import { computed, ref, watch } from 'vue';
import { usePolling } from '../composables/usePolling.js';

const { data, error } = usePolling('/api/ticker', 5000);

const prev = ref(new Map()); // symbol -> last mid
const items = computed(() => {
  const list = data.value?.items || [];
  return list.map((it) => {
    const last = prev.value.get(it.symbol);
    const dir = last == null ? 0 : it.mid > last ? 1 : it.mid < last ? -1 : 0;
    return { ...it, dir };
  });
});

watch(
  () => data.value?.items,
  (list) => {
    if (!list) return;
    const next = new Map(prev.value);
    for (const it of list) next.set(it.symbol, it.mid);
    prev.value = next;
  },
);

const fmtPrice = (v) => {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1000) return v.toFixed(0);
  if (v >= 10) return v.toFixed(2);
  if (v >= 1) return v.toFixed(3);
  if (v >= 0.1) return v.toFixed(4);
  return v.toFixed(5);
};
const fmtSpread = (bp) => (Number.isFinite(bp) ? `${bp.toFixed(1)}bp` : '—');
const dirClass = (d) => (d > 0 ? 'up' : d < 0 ? 'down' : '');
</script>

<template>
  <div class="ticker-row a-ticker" :class="{ err: error }">
    <div v-if="error" class="bad">ticker error: {{ error }}</div>
    <div v-else-if="!items.length" style="color: var(--muted)">loading ticker…</div>
    <div v-else class="marquee">
      <div class="track">
        <span v-for="it in items" :key="'a-' + it.symbol" class="tick" :class="dirClass(it.dir)">
          <span class="sym">{{ it.symbol.replace('USDT', '') }}</span>
          <span class="arrow up" v-if="it.dir > 0">▲</span>
          <span class="arrow down" v-else-if="it.dir < 0">▼</span>
          <span class="px">${{ fmtPrice(it.mid) }}</span>
        </span>
        <span v-for="it in items" :key="'b-' + it.symbol" class="tick" :class="dirClass(it.dir)" aria-hidden="true">
          <span class="sym">{{ it.symbol.replace('USDT', '') }}</span>
          <span class="arrow up" v-if="it.dir > 0">▲</span>
          <span class="arrow down" v-else-if="it.dir < 0">▼</span>
          <span class="px">${{ fmtPrice(it.mid) }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ticker-row { overflow: hidden; display: flex; align-items: center; height: 100%; }
.marquee { width: 100%; overflow: hidden; }
.track {
  display: inline-flex;
  gap: 28px;
  white-space: nowrap;
  animation: scroll 90s linear infinite;
  will-change: transform;
}
.track:hover { animation-play-state: paused; }
@keyframes scroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
.tick { display: inline-flex; gap: 6px; align-items: baseline; font-size: 11px; }
.tick .sym { color: var(--accent-60); letter-spacing: 1px; }
.tick .px  { color: var(--fg); }
.tick .sp  { color: var(--muted-2); font-size: 10px; }
.tick.up  .px { color: var(--ok); }
.tick.down .px { color: var(--bad); }
.arrow { font-size: 8px; line-height: 1; display: inline-block; }
.arrow.up   { color: var(--ok); }
.arrow.down { color: var(--bad); }
</style>
