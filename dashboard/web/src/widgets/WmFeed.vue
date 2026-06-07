<script setup>
import { computed, ref } from 'vue';
import { usePolling } from '../composables/usePolling.js';

const { data, error } = usePolling('/api/wm/feed', 10_000);
const { data: fgData } = usePolling('/api/wm/fear-greed', 60_000);

const TABS = [
  { id: 'fg',   label: 'fear/greed' },
  { id: 'etf',  label: 'etf' },
  { id: 'geo',  label: 'geo' },
];
const tab = ref('fg');

const etf = computed(() => data.value?.data?.etf);
const geo = computed(() => data.value?.data?.geo);

const ttlStr = (ttl) => {
  if (ttl == null) return '';
  if (ttl <= 0) return 'expired';
  if (ttl < 60) return `${ttl}s`;
  return `${Math.floor(ttl / 60)}m`;
};

const geoColor = (score) => {
  if (score >= 70) return 'var(--bad)';
  if (score >= 40) return 'var(--phase-creep_up)';
  if (score >= 10) return 'var(--ok)';
  return 'var(--muted-2)';
};

const etfDir = computed(() => {
  const v = etf.value?.value;
  if (!v) return null;
  const d = v.netDirection || (v.inflowCount > v.outflowCount ? 'INFLOW' : v.outflowCount > v.inflowCount ? 'OUTFLOW' : 'FLAT');
  return d;
});
const etfDirColor = (d) => ({ INFLOW: 'var(--ok)', OUTFLOW: 'var(--bad)', FLAT: 'var(--muted)' }[d] || 'var(--muted-2)');

// Fear & Greed gradient (0-100): red → orange → yellow → green
const fgColor = (v) => {
  if (!Number.isFinite(v)) return 'var(--muted-2)';
  if (v < 25) return 'var(--bad)';
  if (v < 45) return 'var(--phase-downtrend)';
  if (v < 55) return 'var(--phase-creep_up)';
  if (v < 75) return 'var(--ok)';
  return 'var(--ok)';
};
const fgGauge = computed(() => {
  const v = fgData.value?.value;
  if (!Number.isFinite(v)) return null;
  const angle = (v / 100) * 180 - 90; // -90 (left) .. +90 (right)
  return { v, classification: fgData.value.classification, angle, color: fgColor(v) };
});
</script>

<template>
  <div class="widget a-wm">
    <h3>
      <span>wm · {{ tab === 'fg' ? 'fear/greed' : tab }}</span>
      <span style="color:var(--muted);font-size:9px">
        <a v-for="t in TABS" :key="t.id" :class="{ active: tab === t.id }" @click="tab = t.id">{{ t.label }}</a>
      </span>
    </h3>
    <div class="body">
      <div v-if="error" class="bad" style="font-size:10px">err: {{ error }}</div>

      <!-- fear/greed -->
      <template v-else-if="tab === 'fg'">
        <div v-if="!fgGauge" class="placeholder">loading…</div>
        <div v-else class="fg">
          <div class="fg-value" :style="{ color: fgGauge.color }">{{ fgGauge.v }}</div>
          <div class="fg-class">{{ fgGauge.classification }}</div>
          <div class="fg-bar">
            <span v-for="i in 10" :key="i" class="tick"
                  :style="{ background: i * 10 - 5 < fgGauge.v ? fgColor((i - 0.5) * 10) : 'var(--border)' }" />
          </div>
          <div class="fg-scale">
            <span>fear</span><span>neutral</span><span>greed</span>
          </div>
        </div>
      </template>

      <!-- etf -->
      <template v-else-if="tab === 'etf'">
        <div v-if="!etf" class="placeholder">loading…</div>
        <div v-else-if="(etf.empty && !etf.stale) || !etf.value" class="placeholder" style="font-size:10px">empty · key expired</div>
        <div v-else class="etf">
          <div class="etf-dir" :style="{ color: etfDirColor(etfDir) }">{{ etfDir }}</div>
          <div class="etf-counts">
            <span class="c"><span class="k">in</span><span class="v ok">{{ etf.value.inflowCount }}</span></span>
            <span class="c"><span class="k">out</span><span class="v bad">{{ etf.value.outflowCount }}</span></span>
            <span class="c"><span class="k">total</span><span class="v">{{ etf.value.etfCount }}</span></span>
          </div>
          <div class="meta">ttl {{ ttlStr(etf.ttl) }}<span v-if="etf.stale" class="stale"> cached</span></div>
        </div>
      </template>

      <!-- geo -->
      <template v-else-if="tab === 'geo'">
        <div v-if="!geo" class="placeholder">loading…</div>
        <div v-else-if="(geo.empty && !geo.stale) || !Array.isArray(geo.value)" class="placeholder">empty · key expired</div>
        <div v-else class="geo">
          <div v-for="g in geo.value" :key="g.region" class="geo-row">
            <span class="reg">{{ g.region }}</span>
            <div class="bar-wrap">
              <div class="bar" :style="{width: Math.min(100, g.combinedScore) + '%', background: geoColor(g.combinedScore)}" />
            </div>
            <span class="score">{{ g.combinedScore }}</span>
          </div>
          <div class="meta">ttl {{ ttlStr(geo.ttl) }}<span v-if="geo.stale" class="stale"> cached</span></div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
h3 a { cursor: pointer; margin-left: 6px; letter-spacing: 1px; font-size: 9px; color: var(--muted); }
h3 a.active { color: var(--fg); }

.meta { font-size: 9px; color: var(--muted-2); margin-top: 6px; }
.stale { color: var(--phase-creep_up); letter-spacing: 1px; }

/* fear & greed */
.fg { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 4px; }
.fg-value { font-size: 36px; line-height: 1; font-weight: 400; text-shadow: 0 0 12px currentColor; }
.fg-class { font-size: 11px; color: var(--muted); letter-spacing: 1px; }
.fg-bar { display: flex; gap: 2px; width: 90%; margin-top: 4px; }
.fg-bar .tick { flex: 1; height: 8px; }
.fg-scale { display: flex; justify-content: space-between; width: 90%; font-size: 8px; color: var(--muted-2); letter-spacing: 1px; }

/* etf */
.etf { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 6px; }
.etf-dir { font-size: 28px; letter-spacing: 3px; }
.etf-counts { display: flex; gap: 16px; font-size: 10px; }
.etf-counts .c { display: inline-flex; flex-direction: column; align-items: center; gap: 1px; }
.etf-counts .k { color: var(--muted); letter-spacing: 1px; }
.etf-counts .v { color: var(--fg); font-size: 14px; }
.etf-counts .v.ok { color: var(--ok); }
.etf-counts .v.bad { color: var(--bad); }

/* geo */
.geo { display: flex; flex-direction: column; gap: 4px; flex: 1; justify-content: center; }
.geo-row { display: grid; grid-template-columns: 26px 1fr 28px; gap: 6px; align-items: center; font-size: 10px; }
.reg { color: var(--muted); letter-spacing: 1px; }
.bar-wrap { height: 8px; background: var(--accent-08); }
.bar { height: 100%; }
.score { color: var(--fg); text-align: right; font-size: 10px; }
</style>
