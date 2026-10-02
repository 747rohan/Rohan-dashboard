<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { usePolling } from '../composables/usePolling.js';
import { useBtcTick } from '../composables/useBtcTick.js';

// BTC options gamma zones from the gex_server collector on the same host —
// the core of its own panel (price, zones, key strikes, expected move). The
// chart keeps that panel's colours so the two read alike; only the frame is
// this dashboard's. The collector refreshes once a minute.
const group = ref('7D');
const url = computed(() => `/api/gex/zones?group=${group.value}&hours=24`);
const { data, error } = usePolling(url, 30_000);

// The live price is the main chart's own tick, not a second poller, so both
// widgets move on the same second. The zones themselves were computed at the
// collector's spot; only the price is live here.
const { tick } = useBtcTick();
const live = computed(() => (Number.isFinite(tick.value?.mid) ? { ts: tick.value.ts, price: tick.value.mid } : null));
const priceFlash = ref('');
watch(() => live.value?.price, (np, op) => {
  if (np == null || op == null || np === op) return;
  priceFlash.value = np > op ? 'up' : 'down';
  setTimeout(() => { priceFlash.value = ''; }, 600);
});
const shownPrice = computed(() => live.value?.price ?? data.value?.spot);

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

// Palette and zone opacity copied from gex_server/panel.html (`C`, `ALPHA`).
const C = {
  pos: '#3ddc4f', neg: '#a45cf5', zg: '#ffd23f', em: '#4aa3ff',
  maj: '#3ddc4f', min: '#a45cf5', cw: '#8fe39a', pw: '#c9a6f7', mp: '#8a94a0',
  txt: '#aab4c0', dim: '#5c6673', up: '#3ddc4f', dn: '#a45cf5',
};
const ALPHA = { '0D': 0.30, '7D': 0.20, '14D': 0.16, '31D': 0.14, ALL: 0.10, US: 0.16 };
// Same mapping as the panel: zero gamma solid and heavier, major/minor dashed,
// walls and max pain dotted.
const LINE_STYLE = {
  ZG:  { stroke: C.zg,  width: 2, dash: '' },
  MAJ: { stroke: C.maj, width: 1, dash: '5,3' },
  MIN: { stroke: C.min, width: 1, dash: '5,3' },
  CW:  { stroke: C.cw,  width: 1, dash: '1,2' },
  PW:  { stroke: C.pw,  width: 1, dash: '1,2' },
  MP:  { stroke: C.mp,  width: 1, dash: '1,2' },
};
const zoneCol = (type) => (type === 'GEX+' ? C.pos : C.neg);

const PAD_L = 2;
const PAD_R = 62; // room for line labels
const PAD_T = 6;
const PAD_B = 6;

const fmtPx = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—');
const fmtM = (v) => {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : `${(a / 1e3).toFixed(0)}K`;
  return (v >= 0 ? '+' : '−') + s;
};
const ageLabel = (s) => (!Number.isFinite(s) ? '—' : s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);

// Collector candles with the live price carried into the last bar — or into a
// new bar after it, when the file lags behind the current 15m bar.
const BAR_MS = 15 * 60_000;
function withLive(cs, lv) {
  if (!lv || cs.length === 0) return cs;
  const out = cs.slice();
  const last = out[out.length - 1];
  if (lv.ts < last.t) return out;
  if (lv.ts < last.t + BAR_MS) {
    out[out.length - 1] = { ...last, c: lv.price, h: Math.max(last.h, lv.price), l: Math.min(last.l, lv.price) };
  } else {
    const t = last.t + Math.floor((lv.ts - last.t) / BAR_MS) * BAR_MS;
    out.push({ t, o: last.c, h: Math.max(last.c, lv.price), l: Math.min(last.c, lv.price), c: lv.price });
  }
  return out;
}

const view = computed(() => {
  const d = data.value;
  const cs = withLive(d?.candles || [], live.value);
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
  const xR = w - PAD_R;
  // Candles stop short of the label column so the last one never sits on a label.
  const plotW = xR - PAD_L - 6;
  const x = (t) => PAD_L + ((t - t0) / Math.max(t1 - t0, 1)) * plotW;
  const y = (p) => PAD_T + (1 - (p - lo) / (hi - lo)) * (h - PAD_T - PAD_B);
  const inside = (p) => p >= lo && p <= hi;

  const bodyW = Math.max(1, (plotW / cs.length) * 0.6);
  const candles = cs.map((c) => {
    const up = c.c >= c.o;
    const yo = y(c.o), yc = y(c.c);
    return {
      x: x(c.t), yh: y(c.h), yl: y(c.l),
      by: Math.min(yo, yc), bh: Math.max(1, Math.abs(yc - yo)),
      col: up ? C.up : C.dn,
    };
  });

  const alpha = ALPHA[d.group] ?? 0.16;
  const bands = d.zones
    .filter((z) => z.hi >= lo && z.lo <= hi)
    .map((z) => {
      const yt = y(Math.min(z.hi, hi)), yb = y(Math.max(z.lo, lo));
      return { ...z, col: zoneCol(z.type), y: yt, hgt: Math.max(1, yb - yt),
               ys: inside(z.strike) ? y(z.strike) : null };
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
  return { w, h, xR, candles, bodyW, alpha, bands, labels, em, spot: { x: x(last.t), y: y(last.c) } };
});

const zoneRows = computed(() => {
  const zs = data.value?.zones || [];
  // Strongest first within each side, calls (above) before puts (below).
  return [...zs].sort((a, b) => (a.type === b.type ? a.rank - b.rank : a.type === 'GEX+' ? -1 : 1));
});
const CHECK = {
  confirmed:    { s: '✓', t: 'поток сделок подтверждает зону' },
  contradicted: { s: '✗', t: 'поток сделок противоречит зоне' },
  weak:         { s: '·', t: 'поток по зоне слабый' },
};
const regime = computed(() => {
  const r = data.value?.regime;
  if (r === 'positive') return { s: '+γ', col: C.pos, t: 'положительная гамма: дилеры гасят движение' };
  if (r === 'negative') return { s: '−γ', col: C.neg, t: 'отрицательная гамма: дилеры разгоняют движение' };
  return { s: r || '—', col: C.txt, t: '' };
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
          <span class="spot" :class="priceFlash"
                :title="`живая цена BTCUSDT — та же, что на главном графике; зоны рассчитаны при $${fmtPx(data.spot)}`">
            ${{ fmtPx(shownPrice) }}
          </span>
          <span class="reg" :style="{ color: regime.col }" :title="regime.t">{{ regime.s }}</span>
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
            <g v-if="view.em">
              <rect :x="0" :y="view.em.y1" :width="view.xR" :height="view.em.y2 - view.em.y1" :fill="C.em" fill-opacity="0.07" />
              <line :x1="0" :x2="view.xR" :y1="view.em.y1" :y2="view.em.y1" :stroke="C.em" stroke-width="1" stroke-dasharray="2,4" />
              <line :x1="0" :x2="view.xR" :y1="view.em.y2" :y2="view.em.y2" :stroke="C.em" stroke-width="1" stroke-dasharray="2,4" />
            </g>
            <g v-for="(z, i) in view.bands" :key="'z' + i">
              <rect :x="0.5" :y="z.y + 0.5" :width="view.xR - 1" :height="Math.max(1, z.hgt - 1)"
                    :fill="z.col" :fill-opacity="view.alpha" :stroke="z.col" stroke-opacity="0.55" stroke-width="1">
                <title>{{ z.type }} {{ fmtPx(z.lo) }}–{{ fmtPx(z.hi) }} · {{ fmtM(z.value_usd_1pct) }}/1% · ранг {{ z.rank }}</title>
              </rect>
              <line v-if="z.ys != null" :x1="0" :x2="view.xR" :y1="z.ys" :y2="z.ys"
                    :stroke="z.col" stroke-opacity="0.75" stroke-width="1" stroke-dasharray="1,3" />
            </g>
            <g v-for="(c, i) in view.candles" :key="'c' + i">
              <line :x1="c.x" :x2="c.x" :y1="c.yh" :y2="c.yl" :stroke="c.col" stroke-width="1" />
              <rect :x="c.x - view.bodyW / 2" :y="c.by" :width="view.bodyW" :height="c.bh" :fill="c.col" />
            </g>
            <g v-for="(l, i) in view.labels" :key="'l' + i">
              <line v-if="!l.edge" :x1="0" :x2="view.xR" :y1="l.y" :y2="l.y"
                    :stroke="l.st.stroke" :stroke-width="l.st.width" :stroke-dasharray="l.st.dash" />
              <text :x="view.xR + 4" :y="l.ly + 3" class="lbl" :fill="l.st.stroke">
                {{ l.edge || '' }}{{ l.type }} {{ fmtPx(l.price) }}
                <title>{{ l.label }}</title>
              </text>
            </g>
            <circle :cx="view.spot.x" :cy="view.spot.y" r="2.2" fill="var(--fg)" class="spot-dot" />
          </svg>
        </div>
        <div class="zones">
          <div v-for="(z, i) in zoneRows" :key="i" class="zrow" :style="{ color: zoneCol(z.type) }">
            <span>{{ z.type === 'GEX+' ? '▼' : '▲' }} {{ z.type }}</span>
            <span class="zr">{{ fmtPx(z.lo) }}–{{ fmtPx(z.hi) }}</span>
            <span class="zv">{{ fmtM(z.value_usd_1pct) }}</span>
            <span class="zc" :title="CHECK[z.flow_check]?.t">{{ CHECK[z.flow_check]?.s ?? '' }}</span>
            <span class="zs" :title="'совпадение признаков: ' + z.confluence + ' из 5'">{{ '★'.repeat(z.confluence || 0) }}</span>
          </div>
        </div>
        <div class="foot">
          <span>{{ data.title }}</span>
          <span v-if="data.em" :style="{ color: C.em }" title="ожидаемый ход до ближайшей экспирации">EM {{ fmtPx(data.em.lower) }}–{{ fmtPx(data.em.upper) }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.range-switch a { color: var(--muted); cursor: pointer; margin-left: 6px; font-size: 9px; letter-spacing: 1px; }
.range-switch a.active { color: var(--fg); }
.head { display: flex; align-items: baseline; gap: 10px; flex: none; margin-bottom: 4px; font-size: 10px; }
/* Same flash as the main chart's live price, so the two read as one quote. */
.spot {
  font-size: 16px; color: var(--fg); cursor: help;
  transition: color 0.6s ease, text-shadow 0.6s ease;
  text-shadow: 0 0 8px var(--accent-40);
}
.spot.up   { color: var(--ok);  text-shadow: 0 0 10px rgba(143, 184, 143, 0.5); }
.spot.down { color: var(--bad); text-shadow: 0 0 10px rgba(184, 143, 143, 0.5); }
.reg { font-size: 11px; cursor: help; }
.net { color: #aab4c0; cursor: help; }
.age { margin-left: auto; color: #5c6673; cursor: help; }
.warn { color: var(--bad); font-size: 9px; flex: none; margin-bottom: 4px; cursor: help; }
.chart { flex: 1; min-height: 70px; position: relative; }
.chart svg { position: absolute; inset: 0; display: block; }
.lbl { font-size: 8.5px; font-family: inherit; letter-spacing: 0.3px; }
.spot-dot { filter: drop-shadow(0 0 3px rgba(255, 255, 255, 0.6)); }
.zones { flex: none; margin-top: 6px; border-top: 1px dashed var(--accent-15); padding-top: 4px; }
.zrow {
  display: grid; grid-template-columns: 58px 1fr 52px 12px 46px; gap: 4px;
  font-size: 9.5px; line-height: 14px;
}
.zr { color: #aab4c0; }
.zv { text-align: right; }
.zc { text-align: center; cursor: help; }
.zs { opacity: 0.7; font-size: 8px; letter-spacing: -1px; cursor: help; }
.foot { flex: none; display: flex; justify-content: space-between; font-size: 9px; color: #5c6673; margin-top: 4px; }
</style>
