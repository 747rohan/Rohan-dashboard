<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { usePolling } from '../composables/usePolling.js';

// BTC options gamma zones from the gex_server collector on the same host —
// the core of its own panel (price, zones, key strikes, expected move), drawn
// in this dashboard's palette. The collector refreshes once a minute.
const group = ref('7D');
const url = computed(() => `/api/gex/zones?group=${group.value}&hours=24`);
const { data, error } = usePolling(url, 30_000);

// Real pixel size, so labels are not stretched by a non-uniform viewBox.
const box = ref(null);
const W = ref(296);
const H = ref(180);
const ro = new ResizeObserver(([e]) => {
  W.value = Math.max(120, Math.round(e.contentRect.width));
  H.value = Math.max(70, Math.round(e.contentRect.height));
});
// The chart box only exists once data has arrived, so follow the ref rather
// than grabbing it on mount.
watch(box, (el, old) => {
  if (old) ro.unobserve(old);
  if (el) ro.observe(el);
});
onUnmounted(() => ro.disconnect());

const PAD_L = 2;
const PAD_R = 62; // room for line labels
const PAD_T = 6;
const PAD_B = 6;

const LINE_STYLE = {
  ZG:  { stroke: 'var(--accent)',    width: 1.4, dash: '',    name: 'ZG' },
  MAJ: { stroke: 'var(--accent-60)', width: 0.8, dash: '4,3', name: 'MAJ' },
  MIN: { stroke: 'var(--accent-40)', width: 0.8, dash: '4,3', name: 'MIN' },
  CW:  { stroke: 'var(--ok)',        width: 0.8, dash: '1,2', name: 'CW' },
  PW:  { stroke: 'var(--bad)',       width: 0.8, dash: '1,2', name: 'PW' },
  MP:  { stroke: 'var(--muted)',     width: 0.8, dash: '1,3', name: 'MP' },
};
const RANK_ALPHA = { 1: 0.30, 2: 0.18, 3: 0.10 };

const fmtPx = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—');
const fmtM = (v) => {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : `${(a / 1e3).toFixed(0)}K`;
  return (v >= 0 ? '+' : '−') + s;
};
const ageLabel = (s) => (!Number.isFinite(s) ? '—' : s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);

const view = computed(() => {
  const d = data.value;
  const cs = d?.candles || [];
  if (cs.length < 2) return null;
  const w = W.value, h = H.value;

  // Frame on the price itself plus today's expected move; zones and lines
  // further out are clipped to an edge marker instead of flattening the chart.
  let lo = Math.min(...cs.map((c) => c.l));
  let hi = Math.max(...cs.map((c) => c.h));
  if (d.em) { lo = Math.min(lo, d.em.lower); hi = Math.max(hi, d.em.upper); }
  const pad = (hi - lo) * 0.06;
  lo -= pad; hi += pad;

  const t0 = cs[0].t, t1 = cs[cs.length - 1].t;
  // Price stops short of the label column so the spot dot never sits on a label.
  const x = (t) => PAD_L + ((t - t0) / Math.max(t1 - t0, 1)) * (w - PAD_L - PAD_R - 6);
  const y = (p) => PAD_T + (1 - (p - lo) / (hi - lo)) * (h - PAD_T - PAD_B);
  const inside = (p) => p >= lo && p <= hi;
  const xR = w - PAD_R;

  const price = cs.map((c, i) => `${i ? 'L' : 'M'}${x(c.t).toFixed(1)},${y(c.c).toFixed(1)}`).join(' ');
  const wicks = cs.map((c) => ({ x: x(c.t), y1: y(c.h), y2: y(c.l) }));

  const bands = d.zones
    .filter((z) => z.hi >= lo && z.lo <= hi)
    .map((z) => {
      const yt = y(Math.min(z.hi, hi)), yb = y(Math.max(z.lo, lo));
      return { ...z, y: yt, hgt: Math.max(1, yb - yt), alpha: RANK_ALPHA[z.rank] ?? 0.08 };
    });

  // Right-hand labels: sorted by height and nudged apart so close strikes
  // (ZG and a wall a few hundred dollars away) stay readable.
  const labels = [];
  for (const l of d.lines) {
    const st = LINE_STYLE[l.type];
    if (!st) continue;
    if (inside(l.price)) labels.push({ ...l, st, y: y(l.price), edge: null });
    else labels.push({ ...l, st, y: l.price > hi ? PAD_T + 4 : h - PAD_B - 2, edge: l.price > hi ? '↑' : '↓' });
  }
  labels.sort((a, b) => a.y - b.y);
  const GAP = 9;
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y - labels[i - 1].y < GAP) labels[i].ly = (labels[i - 1].ly ?? labels[i - 1].y) + GAP;
  }
  for (const l of labels) l.ly = l.ly ?? l.y;

  const em = d.em && inside(d.em.lower) && inside(d.em.upper) ? { y1: y(d.em.upper), y2: y(d.em.lower) } : null;
  const last = cs[cs.length - 1];
  return { w, h, xR, price, wicks, bands, labels, em, spot: { x: x(last.t), y: y(d.spot ?? last.c) } };
});

const zoneRows = computed(() => {
  const zs = data.value?.zones || [];
  // Strongest first within each side, calls (above) before puts (below).
  return [...zs].sort((a, b) => (a.type === b.type ? a.rank - b.rank : a.type === 'GEX+' ? -1 : 1));
});
const CHECK = {
  confirmed:    { s: '✓', cls: 'ok',  t: 'поток сделок подтверждает зону' },
  contradicted: { s: '✗', cls: 'bad', t: 'поток сделок противоречит зоне' },
  weak:         { s: '·', cls: '',    t: 'поток по зоне слабый' },
};
const regime = computed(() => {
  const r = data.value?.regime;
  if (r === 'positive') return { s: '+γ', cls: 'ok', t: 'положительная гамма: дилеры гасят движение' };
  if (r === 'negative') return { s: '−γ', cls: 'bad', t: 'отрицательная гамма: дилеры разгоняют движение' };
  return { s: r || '—', cls: '', t: '' };
});
</script>

<template>
  <div class="widget a-phases">
    <h3>
      <span>gex · btc options</span>
      <span class="range-switch">
        <a v-for="g in (data?.groups || ['0D','7D','ALL'])" :key="g"
           :class="{ active: group === g }" @click="group = g">{{ g.toLowerCase() }}</a>
      </span>
    </h3>
    <div class="body">
      <div v-if="error" class="bad" style="font-size:10px">err: {{ error }}</div>
      <div v-else-if="!data" class="placeholder">loading…</div>
      <template v-else>
        <div class="head">
          <span class="spot glow">${{ fmtPx(data.spot) }}</span>
          <span class="reg" :class="regime.cls" :title="regime.t">{{ regime.s }}</span>
          <span class="net" title="суммарная гамма группы, $ на 1% хода цены">{{ fmtM(data.net_gex_usd_1pct) }}/1%</span>
          <span class="age" :class="{ bad: data.stale }" :title="data.stale ? 'коллектор GEX давно не обновлял данные' : 'возраст расчёта'">
            {{ data.stale ? 'stale ' : '' }}{{ ageLabel(data.age_s) }}
          </span>
        </div>
        <div v-if="data.failed_checks?.length" class="warn" :title="data.failed_checks.map(c => c.text).join('\n')">
          ⚠ проверки: {{ data.failed_checks.map(c => c.name).join(', ') }}
        </div>
        <div ref="box" class="chart">
          <svg v-if="view" :width="view.w" :height="view.h">
            <rect v-for="(z, i) in view.bands" :key="'z' + i"
                  :x="0" :y="z.y" :width="view.xR" :height="z.hgt"
                  :fill="z.type === 'GEX+' ? 'var(--ok)' : 'var(--bad)'" :fill-opacity="z.alpha">
              <title>{{ z.type }} {{ fmtPx(z.lo) }}–{{ fmtPx(z.hi) }} · {{ fmtM(z.value_usd_1pct) }}/1% · ранг {{ z.rank }}</title>
            </rect>
            <g v-if="view.em">
              <line :x1="0" :x2="view.xR" :y1="view.em.y1" :y2="view.em.y1" stroke="var(--accent-30)" stroke-width="0.6" stroke-dasharray="6,3" />
              <line :x1="0" :x2="view.xR" :y1="view.em.y2" :y2="view.em.y2" stroke="var(--accent-30)" stroke-width="0.6" stroke-dasharray="6,3" />
            </g>
            <line v-for="(w, i) in view.wicks" :key="'w' + i"
                  :x1="w.x" :x2="w.x" :y1="w.y1" :y2="w.y2" stroke="var(--accent-15)" stroke-width="1" />
            <path :d="view.price" fill="none" stroke="var(--accent)" stroke-width="1.1" />
            <g v-for="(l, i) in view.labels" :key="'l' + i">
              <line v-if="!l.edge" :x1="0" :x2="view.xR" :y1="l.y" :y2="l.y"
                    :stroke="l.st.stroke" :stroke-width="l.st.width" :stroke-dasharray="l.st.dash" />
              <text :x="view.xR + 4" :y="l.ly + 3" class="lbl" :fill="l.st.stroke">
                {{ l.edge || '' }}{{ l.st.name }} {{ fmtPx(l.price) }}
                <title>{{ l.label }}</title>
              </text>
            </g>
            <circle :cx="view.spot.x" :cy="view.spot.y" r="2.2" fill="var(--accent)" class="spot-dot" />
          </svg>
        </div>
        <div class="zones">
          <div v-for="(z, i) in zoneRows" :key="i" class="zrow" :class="z.type === 'GEX+' ? 'pos' : 'neg'">
            <span class="zt">{{ z.type === 'GEX+' ? '▼' : '▲' }} {{ z.type }}</span>
            <span class="zr">{{ fmtPx(z.lo) }}–{{ fmtPx(z.hi) }}</span>
            <span class="zv">{{ fmtM(z.value_usd_1pct) }}</span>
            <span class="zc" :class="CHECK[z.flow_check]?.cls" :title="CHECK[z.flow_check]?.t">{{ CHECK[z.flow_check]?.s ?? '' }}</span>
            <span class="zs" :title="'совпадение признаков: ' + z.confluence + ' из 5'">{{ '★'.repeat(z.confluence || 0) }}</span>
          </div>
        </div>
        <div class="foot">
          <span>{{ data.title }}</span>
          <span v-if="data.em" title="ожидаемый ход до ближайшей экспирации">EM {{ fmtPx(data.em.lower) }}–{{ fmtPx(data.em.upper) }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.range-switch a { color: var(--muted); cursor: pointer; margin-left: 6px; font-size: 9px; letter-spacing: 1px; }
.range-switch a.active { color: var(--fg); }
.head { display: flex; align-items: baseline; gap: 10px; flex: none; margin-bottom: 4px; font-size: 10px; }
.spot { font-size: 16px; color: var(--fg); }
.reg { font-size: 11px; cursor: help; }
.net { color: var(--muted); cursor: help; }
.age { margin-left: auto; color: var(--muted-2); cursor: help; }
.warn { color: var(--bad); font-size: 9px; flex: none; margin-bottom: 4px; cursor: help; }
.chart { flex: 1; min-height: 70px; position: relative; }
.chart svg { position: absolute; inset: 0; display: block; }
.lbl { font-size: 8.5px; font-family: inherit; letter-spacing: 0.3px; }
.spot-dot { filter: drop-shadow(0 0 3px var(--accent-60)); }
.zones { flex: none; margin-top: 6px; border-top: 1px dashed var(--accent-15); padding-top: 4px; }
.zrow {
  display: grid; grid-template-columns: 58px 1fr 52px 12px 46px; gap: 4px;
  font-size: 9.5px; line-height: 14px; color: var(--muted);
}
.zrow.pos .zt { color: var(--ok); }
.zrow.neg .zt { color: var(--bad); }
.zr { color: var(--fg); }
.zv { text-align: right; }
.zc { text-align: center; cursor: help; }
.zs { color: var(--accent-60); font-size: 8px; letter-spacing: -1px; cursor: help; }
.foot { flex: none; display: flex; justify-content: space-between; font-size: 9px; color: var(--muted-2); margin-top: 4px; }
</style>
