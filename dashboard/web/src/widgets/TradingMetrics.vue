<script setup>
import { computed } from 'vue';
import { usePolling } from '../composables/usePolling.js';

const { data, error } = usePolling('/api/trading/metrics', 15_000);

const s = computed(() => data.value?.summary || {});

const FIELDS = [
  { key: 'bots',          label: 'bots',          fmt: (v) => (v != null ? String(v) : '—') },
  { key: 'trades',        label: 'trades',        fmt: (v) => (Number.isFinite(v) ? String(v) : '—') },
  { key: 'win_rate',      label: 'win-rate',      fmt: (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—') },
  { key: 'sharpe',        label: 'sharpe',        fmt: (v) => (Number.isFinite(v) ? v.toFixed(2) : '—') },
  { key: 'max_dd',        label: 'max DD',        fmt: (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '—') },
  { key: 'profit_factor', label: 'profit factor', fmt: (v) => (Number.isFinite(v) ? v.toFixed(2) : '—') },
];

const valCls = (key, v) => {
  if (v == null || !Number.isFinite(v)) return 'muted';
  if (key === 'sharpe' || key === 'profit_factor') return v > 0 ? 'ok' : v < 0 ? 'bad' : '';
  if (key === 'max_dd') return v > 0.1 ? 'bad' : v > 0.03 ? '' : 'ok';
  return '';
};
</script>

<template>
  <div class="widget a-metrics">
    <h3>trading · metrics</h3>
    <div class="body">
      <div v-if="error" class="bad" style="font-size:10px">err: {{ error }}</div>
      <div v-else-if="!data">loading…</div>
      <div v-else class="fields">
        <div v-for="f in FIELDS" :key="f.key" class="field">
          <span class="k">{{ f.label }}</span>
          <span class="v" :class="valCls(f.key, s[f.key])">{{ f.fmt(s[f.key]) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fields { display: flex; flex-direction: column; gap: 0; height: 100%; justify-content: space-around; overflow: hidden; }
.field {
  display: flex; justify-content: space-between; align-items: baseline;
  border-bottom: 1px dashed var(--accent-15);
  padding: 2px 0;
  font-size: 11px;
  flex-shrink: 1;
  min-height: 0;
}
.field:last-child { border-bottom: none; }
.k { color: var(--muted); letter-spacing: 1px; }
.v { color: var(--fg); transition: color 0.3s, text-shadow 0.3s; }
.v.muted { color: var(--muted-2); }
.v.ok    { color: var(--ok); text-shadow: 0 0 6px rgba(143, 184, 143, 0.35); }
.v.bad   { color: var(--bad); text-shadow: 0 0 6px rgba(184, 143, 143, 0.35); }
</style>
