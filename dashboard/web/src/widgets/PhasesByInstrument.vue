<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { usePolling } from '../composables/usePolling.js';

const { data, error } = usePolling('/api/phases/current', 15_000);

const SYMBOL_ORDER = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LTCUSDT', 'NEARUSDT',
  'APTUSDT', 'ARBUSDT', 'OPUSDT', 'POLUSDT', 'SUIUSDT',
  'INJUSDT', 'TIAUSDT', 'ATOMUSDT', 'DOTUSDT', 'FILUSDT',
  'LINKUSDT', 'TRXUSDT',
];

function instToSym(instId) {
  if (!instId) return '';
  const m = instId.match(/^([A-Z0-9]+)-USDT/);
  return m ? `${m[1]}USDT` : instId;
}

const cells = computed(() => {
  const byInst = new Map();
  for (const p of data.value?.phases || []) {
    byInst.set(instToSym(p.instId), p);
  }
  return SYMBOL_ORDER.map((sym) => {
    const p = byInst.get(sym) || null;
    // 7RL no longer emits per-symbol phase changes, so most of these readings
    // only get older. A cell that has not moved in hours is not "now" and must
    // not be shown as if it were.
    const ageS = p && Number.isFinite(p.age_s) ? p.age_s : null;
    return {
      symbol: sym,
      short: sym.replace('USDT', ''),
      p,
      ageS,
      stale: ageS != null && ageS > 6 * 3600,
      ageLabel: ageS == null ? '' : ageS < 3600 ? `${Math.floor(ageS / 60)}м` : `${Math.floor(ageS / 3600)}ч`,
    };
  });
});

const counts = computed(() => {
  const acc = {};
  for (const c of cells.value) {
    if (!c.p || c.stale) continue;
    acc[c.p.phase] = (acc[c.p.phase] || 0) + 1;
  }
  return acc;
});

const staleCount = computed(() => cells.value.filter((c) => c.stale).length);

const ageStr = computed(() => {
  const ms = data.value?.age_ms;
  if (typeof ms !== 'number') return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
});

const phaseColor = (p) => `var(--phase-${p || 'unknown'}, var(--phase-unknown))`;
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
const volSigil = (vr) => ({ low: '·', normal: '=', high: '^' }[vr] || '?');

const gridRef = ref(null);
const paused = ref(false);
let scrollTimer = null;

onMounted(() => {
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (isTouch) return;
  scrollTimer = setInterval(() => {
    const el = gridRef.value;
    if (!el || paused.value) return;
    el.scrollTop += 0.4;
    if (el.scrollTop >= el.scrollHeight - el.clientHeight - 2) {
      setTimeout(() => { if (el) el.scrollTop = 0; }, 1500);
    }
  }, 30);
});
onUnmounted(() => { if (scrollTimer) clearInterval(scrollTimer); });
</script>

<template>
  <div class="widget a-phases">
    <h3>
      <span>phases · 22</span>
      <span v-if="staleCount" class="stale-note">{{ staleCount }} без обновлений &gt;6ч</span>
    </h3>
    <div class="body">
      <div v-if="error" class="bad" style="font-size:10px">err: {{ error }}</div>
      <div v-else-if="!data">loading…</div>
      <div v-else-if="!data.ok" class="placeholder" style="font-size:10px">
        ожидаем push от phase-broadcaster…
      </div>
      <template v-else>
        <div class="counts">
          <span v-for="(n, p) in counts" :key="p">
            <span :style="{background:phaseColor(p)}" class="dot" />
            <span style="color:var(--muted)">{{ p }}</span>
            <span style="margin-left:3px">{{ n }}</span>
          </span>
        </div>
        <div ref="gridRef" class="grid" @mouseenter="paused = true" @mouseleave="paused = false">
          <div
            v-for="c in cells" :key="c.symbol"
            class="cell"
            :class="{ empty: !c.p, stale: c.stale }"
            :style="c.p ? { borderLeftColor: phaseColor(c.p.phase) } : {}"
          >
            <div class="row1">
              <span class="sym">
                <span v-if="c.p && !c.stale" class="pulse-dot" :style="{background: phaseColor(c.p.phase), color: phaseColor(c.p.phase)}" />
                <span v-else-if="c.p" class="dead-dot" :style="{background: phaseColor(c.p.phase)}" />
                {{ c.short }}
              </span>
              <span v-if="c.p" class="conf" :class="{ old: c.stale }">{{ c.stale ? c.ageLabel : pct(c.p.confidence) }}</span>
            </div>
            <div class="row2" v-if="c.p">
              <span class="phase" :style="{color: phaseColor(c.p.phase)}">{{ c.p.phase }}</span>
              <span class="vol" :title="'vol_regime: ' + c.p.vol_regime">{{ volSigil(c.p.vol_regime) }}</span>
            </div>
            <div class="row2" v-else>
              <span class="phase" style="color:var(--muted-2)">—</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.counts {
  display: flex; gap: 12px; font-size: 10px; margin-bottom: 8px; flex-wrap: wrap; flex: none;
}
.counts .dot {
  display: inline-block; width: 7px; height: 7px; margin-right: 4px; vertical-align: middle;
}
.grid {
  flex: 1; min-height: 0; overflow-y: hidden;
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 3px;
  padding: 4px 0;
  mask-image: linear-gradient(to bottom, transparent 0%, black 6%, black 90%, transparent 100%);
  scroll-behavior: smooth;
}
.grid:hover { overflow-y: auto; }
.cell {
  border: 1px solid var(--border);
  border-left: 3px solid var(--muted-2);
  padding: 4px 6px;
  font-size: 10px;
  display: flex; flex-direction: column; gap: 1px;
  min-width: 0;
  transition: border-left-color 0.6s ease, background 0.3s ease;
}
.cell:hover {
  background: rgba(var(--ar), var(--ag), var(--ab), 0.04);
}
.cell.empty { opacity: 0.4; }
/* A reading nobody has refreshed in hours must not look live. */
.cell.stale { opacity: 0.42; border-left-style: dashed; }
.dead-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; opacity: 0.5; }
.conf.old { color: var(--bad); }
.stale-note { color: var(--bad); font-size: 9px; letter-spacing: 0; margin-left: 8px; }
.row1 { display: flex; justify-content: space-between; }
.row2 { display: flex; justify-content: space-between; color: var(--muted); font-size: 9px; }
.sym { color: var(--fg); letter-spacing: 1px; display: inline-flex; align-items: center; gap: 5px; }
.pulse-dot {
  display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  animation: cellPulse 1.8s ease-in-out infinite;
}
@keyframes cellPulse {
  0%, 100% { opacity: 1;    box-shadow: 0 0 0 0 currentColor; }
  50%      { opacity: 0.55; box-shadow: 0 0 4px 1px currentColor; }
}
.conf { color: var(--muted); }
.phase { color: var(--muted); }
.vol { color: var(--muted-2); }
</style>
