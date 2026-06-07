<script setup>
import { computed, ref, watch } from 'vue';
import { usePolling } from '../composables/usePolling.js';

const { data, error } = usePolling('/api/btc/phase-detector', 30_000);

const PHASE_ORDER = ['uptrend', 'creep_up', 'ranging', 'creep_down', 'downtrend'];

function dominant(probs) {
  if (!probs) return null;
  let best = null;
  for (const p of PHASE_ORDER) {
    const v = probs[p] || 0;
    if (!best || v > best.v) best = { p, v };
  }
  return best;
}

function deltas(current, baseline) {
  if (!current || !baseline) return {};
  const out = {};
  for (const p of PHASE_ORDER) {
    const c = (current[p] || 0) * 100;
    const b = (baseline[p] || 0) * 100;
    out[p] = Math.round(c - b);
  }
  return out;
}

const rows = computed(() => {
  if (!data.value) return null;
  const d = data.value;
  const cur = d.phase_current;
  const prev1h = d.phase_prev_1h;
  return [
    { label: 'now',              probs: cur,              dom: dominant(cur),              delta: deltas(cur, prev1h),       deltaLabel: 'vs 1h ago' },
    { label: 'prediction +1h',   probs: d.phase_pred_1h,  dom: dominant(d.phase_pred_1h),  delta: deltas(d.phase_pred_1h, cur),  deltaLabel: 'vs now' },
    { label: 'prediction +4h',   probs: d.phase_pred_4h,  dom: dominant(d.phase_pred_4h),  delta: deltas(d.phase_pred_4h, cur),  deltaLabel: 'vs now' },
    { label: 'prediction +24h',  probs: d.phase_pred_24h, dom: dominant(d.phase_pred_24h), delta: deltas(d.phase_pred_24h, cur), deltaLabel: 'vs now' },
  ];
});

const ageStr = computed(() => {
  const ts = data.value?.ts;
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
});

// Track previous dominant phase for transition animation
const prevDominants = ref({});
const transitionKey = ref(0);
watch(
  () => rows.value,
  (newRows, oldRows) => {
    if (!newRows || !oldRows) return;
    let changed = false;
    for (let i = 0; i < newRows.length; i++) {
      const nk = newRows[i]?.dom?.p;
      const ok = oldRows[i]?.dom?.p;
      if (nk && ok && nk !== ok) changed = true;
    }
    if (changed) transitionKey.value++;
  },
);

const phaseColor = (p) => `var(--phase-${p || 'unknown'}, var(--phase-unknown))`;
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
const fmtDelta = (d) => {
  if (!Number.isFinite(d) || d === 0) return '0';
  return (d > 0 ? '+' : '') + d;
};
const deltaCls = (d) => {
  if (!Number.isFinite(d) || d === 0) return 'delta-zero';
  return d > 0 ? 'delta-up' : 'delta-down';
};
</script>

<template>
  <div class="widget a-detector">
    <h3>
      <span>btc · phase detector v2</span>
    </h3>
    <div class="body">
      <div v-if="error" class="bad" style="font-size:10px">err: {{ error }}</div>
      <div v-else-if="!rows">loading…</div>
      <div v-else class="rows" :key="transitionKey">
        <div v-for="r in rows" :key="r.label" class="row">
          <div class="head">
            <span class="lab">{{ r.label }}</span>
            <span v-if="r.dom" class="dom">
              <span
                class="dot"
                :class="{ 'pulse-strong': r.label === 'now', 'pulse-soft': r.label !== 'now' }"
                :style="{background:phaseColor(r.dom.p), color: phaseColor(r.dom.p)}"
              />
              <span class="dom-ph">{{ r.dom.p }}</span>
              <span class="dom-pct">{{ pct(r.dom.v) }}</span>
            </span>
          </div>
          <div class="dist" v-if="r.probs">
            <div v-for="ph in PHASE_ORDER" :key="ph" class="ph">
              <span class="name">{{ ph }}</span>
              <span class="val-group">
                <span class="val">{{ pct(r.probs[ph] || 0) }}</span>
                <span class="delta" :class="deltaCls(r.delta[ph])">
                  ({{ fmtDelta(r.delta[ph]) }})
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rows {
  display: flex; flex-direction: column; gap: 4px; height: 100%; justify-content: space-between;
  animation: fadeSlideIn 0.6s ease;
}
@keyframes fadeSlideIn {
  from { opacity: 0.4; transform: translateY(4px); }
  to   { opacity: 1;   transform: translateY(0); }
}
.row { padding: 3px 0; border-bottom: 1px dashed var(--accent-15); flex: 1; display: flex; flex-direction: column; justify-content: center; min-height: 0; }
.row:last-child { border-bottom: none; }
.head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 3px; }
.lab { color: var(--muted); letter-spacing: 2px; font-size: 10px; }
.dom { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; }
.dom .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.dom .dot.pulse-strong {
  animation: dotPulse 1.4s ease-in-out infinite;
}
.dom .dot.pulse-soft {
  animation: dotPulseSoft 2.2s ease-in-out infinite;
}
@keyframes dotPulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 currentColor; }
  50%      { opacity: 0.75; box-shadow: 0 0 6px 1px currentColor; }
}
@keyframes dotPulseSoft {
  0%, 100% { opacity: 0.85; }
  50%      { opacity: 0.45; }
}
.dom-ph { color: var(--fg); }
.dom-pct { color: var(--muted); font-size: 10px; }
.dist { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
.ph { display: flex; justify-content: space-between; font-size: 9px; padding: 0; line-height: 1.3; }
.ph .name { color: var(--muted); }
.val-group { display: inline-flex; align-items: baseline; gap: 2px; min-width: 52px; justify-content: flex-end; }
.ph .val { color: var(--fg); }
.delta {
  font-size: 8px;
  font-weight: 600;
  min-width: 22px;
  text-align: right;
  transition: color 0.4s ease, opacity 0.4s ease;
}
.delta-up   { color: var(--ok); }
.delta-down { color: var(--bad); }
.delta-zero { color: #888; }
</style>
