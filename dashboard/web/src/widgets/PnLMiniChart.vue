<script setup>
import { computed, ref } from 'vue';
import { usePolling } from '../composables/usePolling.js';

const range = ref('all');
const url = computed(() => `/api/pnl/equity?range=${range.value}`);
const { data, error } = usePolling(url, 30_000);

const W = 300;
const H = 120;
const PAD_L = 6;
const PAD_R = 6;
const PAD_T = 10;
const PAD_B = 14;

const view = computed(() => {
  const pts = data.value?.series || [];
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.ts);
  const ys = pts.map((p) => p.equity);
  const xMin = xs[0], xMax = xs[xs.length - 1];
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const span = Math.max(yMax - yMin, 0.01);
  const first = ys[0];

  const x = (t) => PAD_L + ((t - xMin) / Math.max(xMax - xMin, 1)) * (W - PAD_L - PAD_R);
  const y = (v) => PAD_T + (1 - (v - yMin) / span) * (H - PAD_T - PAD_B);

  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ts).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ');
  const areaPath =
    `M${x(pts[0].ts).toFixed(1)},${(H - PAD_B).toFixed(1)} ` +
    pts.map((p) => `L${x(p.ts).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ') +
    ` L${x(pts[pts.length - 1].ts).toFixed(1)},${(H - PAD_B).toFixed(1)} Z`;

  return { path, areaPath, firstY: y(first), lastPt: pts[pts.length - 1], lastX: x(pts[pts.length - 1].ts), lastY: y(pts[pts.length - 1].equity) };
});

const pnlCls = computed(() => {
  const d = data.value?.delta_usd;
  if (!Number.isFinite(d)) return '';
  if (Math.abs(d) < 0.005) return '';
  return d > 0 ? 'ok' : 'bad';
});
const fmtUsd = (v) => {
  if (!Number.isFinite(v)) return '—';
  const s = (v >= 0 ? '+' : '') + '$' + Math.abs(v).toFixed(2);
  return v < 0 ? '-' + s.slice(1) : s;
};
const fmtPct = (v) => {
  if (!Number.isFinite(v)) return '—';
  const pct = v * 100;
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
};
</script>

<template>
  <div class="widget a-pnl">
    <h3>
      <span>pnl · equity</span>
      <span class="range-switch">
        <a v-for="r in ['24h','7d','30d','all']" :key="r"
           :class="{ active: range === r }"
           @click="range = r">{{ r }}</a>
      </span>
    </h3>
    <div class="body">
      <div v-if="error" class="bad" style="font-size:10px">err: {{ error }}</div>
      <div v-else-if="!data" class="placeholder">loading…</div>
      <template v-else>
        <div class="headline">
          <span class="usd" :class="pnlCls">{{ fmtUsd(data.delta_usd) }}</span>
          <span class="pct" :class="pnlCls">{{ fmtPct(data.delta_pct) }}</span>
          <span class="status-online"><span class="pulse-dot" />Online</span>
        </div>
        <div class="sub">
          <span>{{ data.first_equity != null ? '$' + data.first_equity.toFixed(2) : '—' }}</span>
          <span style="color:var(--muted-2)">→</span>
          <span>{{ data.last_equity != null ? '$' + data.last_equity.toFixed(2) : '—' }}</span>
        </div>
        <svg v-if="view" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" style="width:100%;flex:1;min-height:50px">
          <defs>
            <linearGradient id="pnl-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stop-color="var(--accent)" stop-opacity="0.14" />
              <stop offset="1" stop-color="var(--accent)" stop-opacity="0" />
            </linearGradient>
          </defs>
          <line :x1="PAD_L" :x2="W - PAD_R" :y1="view.firstY" :y2="view.firstY"
                stroke="var(--border-hi)" stroke-width="0.5" stroke-dasharray="2,2" />
          <path :d="view.areaPath" fill="url(#pnl-area)" />
          <path :d="view.path" fill="none" stroke="var(--accent)" stroke-width="1.2" />
          <circle :cx="view.lastX" :cy="view.lastY" r="2" fill="var(--accent)" />
        </svg>
        <div v-else class="placeholder" style="font-size:10px">not enough points yet</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.status-online {
  display: inline-flex; align-items: center; gap: 4px;
  color: var(--ok); font-size: 9px; letter-spacing: 1px;
  margin-left: auto;
}
.status-online .pulse-dot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--ok);
  animation: onlinePulse 1.6s ease-in-out infinite;
}
@keyframes onlinePulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 var(--ok); }
  50%      { opacity: 0.6; box-shadow: 0 0 5px 1px var(--ok); }
}
.range-switch a { color: var(--muted); cursor: pointer; margin-left: 6px; font-size: 9px; letter-spacing: 1px; }
.range-switch a.active { color: var(--fg); }
.headline { display: flex; align-items: baseline; gap: 10px; margin-bottom: 2px; flex: none; }
.usd { font-size: 22px; letter-spacing: 0; transition: color 0.3s, text-shadow 0.3s; }
.pct { font-size: 13px; color: var(--muted); }
.usd.ok, .pct.ok { color: var(--ok); }
.usd.bad, .pct.bad { color: var(--bad); }
.usd.ok { text-shadow: 0 0 8px rgba(143, 184, 143, 0.4); }
.usd.bad { text-shadow: 0 0 8px rgba(184, 143, 143, 0.4); }
.sub { font-size: 10px; color: var(--muted); margin-bottom: 4px; flex: none; }
.sub .n { color: var(--muted-2); margin-left: 4px; }
</style>
