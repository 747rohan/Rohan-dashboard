<script setup>
import { computed, ref, watch } from 'vue';
import { usePolling } from '../composables/usePolling.js';

const WINDOW_DAYS = 10;
const fromIso = () => new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
const priceUrl = computed(() => `/api/btc/price?tf=1h&from=${fromIso()}`);
const phaseUrl = computed(() => `/api/phases/distribution?from=${fromIso()}&smooth=5`);
const { data: priceData, error: priceErr } = usePolling(priceUrl, 30_000);
const { data: phaseData } = usePolling(phaseUrl, 30_000);
const { data: tickData } = usePolling('/api/btc/tick', 1_000);

const priceFlash = ref(''); // 'up' | 'down' | ''
const lastLivePrice = ref(null);

const utcClock = ref('');
let clockTimer = null;
function updateClock() {
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  utcClock.value = `${hh}:${mm}:${ss}`;
}
updateClock();
import { onMounted as onM2, onUnmounted as onU2 } from 'vue';
onM2(() => { clockTimer = setInterval(updateClock, 1000); });
onU2(() => { if (clockTimer) clearInterval(clockTimer); });

const svgRef = ref(null);
const hover = ref(null);

const W = 1000;
const H = 300;
const PAD_L = 44;
const PAD_R = 58;
const PAD_T = 10;
const PAD_B = 32; // more room for X-axis labels

const PHASES = ['uptrend', 'creep_up', 'ranging', 'creep_down', 'downtrend'];
// `ranging` is the classifier's resting state — it holds ~64% of the market on
// an average hour, which pins the four directional phases into the bottom
// third of the chart. Drawing only the directional ones, on a scale of their
// own, is what makes a turn in the market visible. The crosshair still reports
// all five.
const PLOT_PHASES = PHASES.filter((p) => p !== 'ranging');
const phaseColor = (p) => `var(--phase-${p})`;

const liveBtc = computed(() => {
  const t = tickData.value;
  return t && Number.isFinite(t.mid) ? { ts: t.ts, price: t.mid } : null;
});

watch(
  () => liveBtc.value?.price,
  (np, op) => {
    if (np == null) return;
    if (op != null && np !== op) {
      priceFlash.value = np > op ? 'up' : 'down';
      setTimeout(() => { priceFlash.value = ''; }, 600);
    }
    lastLivePrice.value = np;
  },
);

function pickTimeTicks(tsMin, tsMax, targetN = 7) {
  const span = tsMax - tsMin;
  const HOUR = 3600_000, DAY = 86_400_000;
  let step;
  if (span <= 12 * HOUR)      step = HOUR;
  else if (span <= 3 * DAY)   step = 4 * HOUR;
  else if (span <= 10 * DAY)  step = DAY;
  else if (span <= 30 * DAY)  step = 2 * DAY;
  else                         step = 7 * DAY;
  // scale step so we get roughly targetN
  while ((span / step) > targetN * 1.5) step *= 2;
  while ((span / step) < targetN / 2) step /= 2;
  const first = Math.ceil(tsMin / step) * step;
  const out = [];
  for (let t = first; t <= tsMax; t += step) out.push(t);
  return { ticks: out, step };
}

function fmtTsAxis(ts, step) {
  const d = new Date(ts);
  const DAY = 86_400_000;
  const pad = (n) => String(n).padStart(2, '0');
  if (step < DAY) {
    return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:00`;
  }
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}`;
}

const view = computed(() => {
  const histPts = priceData.value?.points || [];
  if (histPts.length < 2) return null;

  const pts = histPts.slice();
  const live = liveBtc.value;
  if (live && live.ts > pts[pts.length - 1].ts) {
    pts.push({ ts: live.ts, close: live.price, real: true, live: true });
  }

  const tsMin = pts[0].ts;
  const tsMax = pts[pts.length - 1].ts;

  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { if (p.close < lo) lo = p.close; if (p.close > hi) hi = p.close; }
  const span = Math.max(hi - lo, 1);
  const padV = span * 0.05;
  lo -= padV; hi += padV;

  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const x = (t) => PAD_L + ((t - tsMin) / Math.max(tsMax - tsMin, 1)) * chartW;
  const invX = (px) => tsMin + ((px - PAD_L) / chartW) * (tsMax - tsMin);
  const yPrice = (v) => PAD_T + (1 - (v - lo) / (hi - lo)) * chartH;
  const invYPrice = (py) => hi - ((py - PAD_T) / chartH) * (hi - lo);
  // Single continuous price path
  const pricePath = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ts).toFixed(1)},${yPrice(p.close).toFixed(1)}`)
    .join(' ');

  // Phase points (already continuous after backend interpolation)
  const phPoints = (phaseData.value?.points || []).filter((p) => p.ts >= tsMin && p.ts <= tsMax);

  // Scale the phase axis to the directional phases actually on screen, rounded
  // up to a whole 5%, so a quiet market does not flatten them onto the floor.
  const plottedVals = [];
  for (const p of phPoints) {
    for (const ph of PLOT_PHASES) {
      const v = p[ph];
      if (Number.isFinite(v)) plottedVals.push(v);
    }
  }
  const pctMax = Math.min(1, Math.max(0.1, Math.ceil(Math.max(0, ...plottedVals) * 20) / 20));
  const yPct = (v) => PAD_T + (1 - v / pctMax) * chartH;
  const invYPct = (py) => (1 - (py - PAD_T) / chartH) * pctMax;

  const phaseLines = {};
  for (const ph of PLOT_PHASES) {
    const segs = [];
    for (let i = 0; i < phPoints.length; i++) {
      const p = phPoints[i];
      const v = p[ph];
      if (v == null || !Number.isFinite(v)) continue;
      segs.push(`${i === 0 ? 'M' : 'L'}${x(p.ts).toFixed(1)},${yPct(v).toFixed(1)}`);
    }
    phaseLines[ph] = segs.join(' ');
  }

  const priceTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => ({
    v: lo + frac * (hi - lo),
    y: PAD_T + (1 - frac) * chartH,
  }));
  const pctTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => ({
    v: frac * pctMax,
    y: PAD_T + (1 - frac) * chartH,
  }));

  const { ticks: timeTickTs, step: timeStep } = pickTimeTicks(tsMin, tsMax);
  const timeTicks = timeTickTs.map((t) => ({ ts: t, x: x(t), label: fmtTsAxis(t, timeStep) }));

  return {
    pts, phPoints,
    tsMin, tsMax, lo, hi,
    chartW, chartH,
    pricePath, phaseLines, priceTicks, pctTicks, timeTicks, pctMax,
    x, yPrice, yPct, invX, invYPrice, invYPct,
    last: pts[pts.length - 1],
    lastX: x(pts[pts.length - 1].ts),
    lastY: yPrice(pts[pts.length - 1].close),
    isLive: !!live,
  };
});

const cross = computed(() => {
  const h = hover.value;
  const v = view.value;
  if (!h || !v) return null;
  if (h.x < PAD_L || h.x > W - PAD_R || h.y < PAD_T || h.y > H - PAD_B) return null;
  const ts = v.invX(h.x);
  let nearest = v.pts[0], bestD = Infinity;
  for (const p of v.pts) {
    const d = Math.abs(p.ts - ts);
    if (d < bestD) { bestD = d; nearest = p; }
  }
  let nph = null, bestPD = Infinity;
  for (const p of v.phPoints) {
    const d = Math.abs(p.ts - ts);
    if (d < bestPD) { bestPD = d; nph = p; }
  }
  return { x: h.x, y: h.y, ts, nearest, nph, atPrice: v.invYPrice(h.y), atPct: v.invYPct(h.y) };
});

function svgCoords(clientX, clientY) {
  const svg = svgRef.value;
  if (!svg) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  return pt.matrixTransform(ctm.inverse());
}
function onMove(e) {
  const loc = svgCoords(e.clientX, e.clientY);
  if (loc) hover.value = { x: loc.x, y: loc.y };
}
function onTouch(e) {
  if (e.touches.length !== 1) return;
  e.preventDefault();
  const t = e.touches[0];
  const loc = svgCoords(t.clientX, t.clientY);
  if (loc) hover.value = { x: loc.x, y: loc.y };
}
function onLeave() { hover.value = null; }

const fmtPrice = (v) => (v >= 1000 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4));
const fmtPct = (v) => `${Math.round(v * 100)}%`;
const fmtTs = (ts) => new Date(ts).toLocaleString();
</script>

<template>
  <div class="widget a-btc">
    <h3>
      <span>btcusdt · 1h <span class="utc-clock">{{ utcClock }} UTC</span> <span v-if="view?.isLive" class="live-pulse">●</span></span>
      <span v-if="liveBtc" class="live-price" :class="priceFlash">
        {{ fmtPrice(liveBtc.price) }}
      </span>
      <span v-else-if="view" style="color: var(--fg); font-size: 15px; letter-spacing: 0">
        {{ fmtPrice(view.last.close) }}
      </span>
    </h3>
    <div class="body">
      <div v-if="priceErr" class="bad">error: {{ priceErr }}</div>
      <div v-else-if="!view" class="placeholder">loading BTC candles…</div>
      <svg
        v-else ref="svgRef"
        :viewBox="`0 0 ${W} ${H + 18}`" preserveAspectRatio="none"
        style="width:100%;height:100%;flex:1"
        @mousemove="onMove" @mouseleave="onLeave"
        @touchmove="onTouch" @touchend="onLeave"
      >
        <!-- horizontal grid -->
        <g>
          <line
            v-for="(t, i) in view.priceTicks" :key="'g'+i"
            :x1="PAD_L" :x2="W - PAD_R" :y1="t.y" :y2="t.y"
            stroke="var(--border-hi)" stroke-width="0.5" stroke-dasharray="2,3"
          />
        </g>
        <!-- left axis: % -->
        <g>
          <text
            v-for="(t, i) in view.pctTicks" :key="'lpct'+i"
            :x="PAD_L - 6" :y="t.y + 3"
            text-anchor="end" fill="var(--muted)" font-size="9"
          >{{ fmtPct(t.v) }}</text>
        </g>
        <!-- right axis: $ -->
        <g>
          <text
            v-for="(t, i) in view.priceTicks" :key="'rpx'+i"
            :x="W - PAD_R + 4" :y="t.y + 3"
            fill="var(--muted)" font-size="9"
          >{{ fmtPrice(t.v) }}</text>
        </g>

        <!-- vertical grid + time axis labels -->
        <g>
          <line
            v-for="(t, i) in view.timeTicks" :key="'tg'+i"
            :x1="t.x" :x2="t.x" :y1="PAD_T" :y2="H - PAD_B"
            stroke="var(--border-hi)" stroke-width="0.4" stroke-dasharray="2,3"
          />
          <text
            v-for="(t, i) in view.timeTicks" :key="'tl'+i"
            :x="t.x" :y="H - PAD_B + 12"
            text-anchor="middle" fill="var(--muted)" font-size="9"
          >{{ t.label }}</text>
        </g>

        <!-- phase lines -->
        <g fill="none" stroke-width="1" stroke-linejoin="round">
          <path
            v-for="ph in PLOT_PHASES" :key="ph"
            :d="view.phaseLines[ph]"
            :stroke="phaseColor(ph)"
            stroke-opacity="0.85"
          />
        </g>

        <!-- price line -->
        <path :d="view.pricePath" fill="none" stroke="var(--fg)" stroke-width="1.3" />

        <!-- live dot -->
        <circle v-if="view.isLive" :cx="view.lastX" :cy="view.lastY" r="2.8" fill="var(--fg)">
          <animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite" />
        </circle>

        <!-- legend -->
        <g :transform="`translate(${PAD_L}, ${H + 12})`">
          <g>
            <line x1="0" x2="12" y1="0" y2="0" stroke="var(--fg)" stroke-width="1.3" />
            <text x="18" y="3" fill="var(--muted)" font-size="9">price</text>
          </g>
          <g v-for="(ph, i) in PLOT_PHASES" :key="ph" :transform="`translate(${70 + i * 90}, 0)`">
            <line x1="0" x2="12" y1="0" y2="0" :stroke="phaseColor(ph)" stroke-width="1.1" />
            <text x="18" y="3" fill="var(--muted)" font-size="9">{{ ph }}</text>
          </g>
          <text :x="70 + PLOT_PHASES.length * 90" y="3" fill="var(--muted-2)" font-size="9">
            ranging скрыт · шкала 0–{{ fmtPct(view.pctMax) }}
          </text>
        </g>

        <!-- crosshair -->
        <template v-if="cross">
          <line :x1="cross.x" :x2="cross.x" :y1="PAD_T" :y2="H - PAD_B" stroke="var(--muted)" stroke-width="0.5" stroke-dasharray="3,3" />
          <line :x1="PAD_L" :x2="W - PAD_R" :y1="cross.y" :y2="cross.y" stroke="var(--muted)" stroke-width="0.5" stroke-dasharray="3,3" />
          <text :x="PAD_L - 6" :y="cross.y + 3" text-anchor="end" fill="var(--fg)" font-size="9">{{ fmtPct(cross.atPct) }}</text>
          <text :x="W - PAD_R + 6" :y="cross.y + 3" fill="var(--fg)" font-size="9">{{ fmtPrice(cross.atPrice) }}</text>
          <g :transform="`translate(${cross.x < W / 2 ? W - PAD_R - 180 : PAD_L + 8}, ${PAD_T + 6})`">
            <rect x="0" y="0" width="178" height="92" fill="var(--panel)" stroke="var(--border-hi)" stroke-width="0.5" />
            <text x="6" y="12" fill="var(--muted)" font-size="9">{{ fmtTs(cross.nearest.ts) }}</text>
            <text x="6" y="26" fill="var(--fg)" font-size="11">
              price ${{ fmtPrice(cross.nearest.close) }}
              <tspan v-if="cross.nearest.real === false" fill="var(--muted-2)"> (sim)</tspan>
            </text>
            <template v-if="cross.nph">
              <text v-for="(ph, i) in PHASES" :key="ph"
                :x="6" :y="42 + i * 10"
                :fill="phaseColor(ph)" font-size="9"
              >{{ ph }}: {{ fmtPct(cross.nph[ph] || 0) }}</text>
            </template>
          </g>
        </template>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.live-pulse { color: var(--ok); animation: pulse 1.2s infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }
.utc-clock { color: var(--muted); font-size: 11px; letter-spacing: 1px; margin-left: 8px; font-variant-numeric: tabular-nums; }
.live-price {
  color: var(--fg);
  font-size: 15px;
  letter-spacing: 0;
  transition: color 0.6s ease, text-shadow 0.6s ease;
  text-shadow: 0 0 8px var(--accent-40);
}
.live-price.up   { color: var(--ok); text-shadow: 0 0 10px rgba(143, 184, 143, 0.5); }
.live-price.down { color: var(--bad); text-shadow: 0 0 10px rgba(184, 143, 143, 0.5); }
</style>
