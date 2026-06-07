<script setup>
import { onMounted, onBeforeUnmount, ref, shallowRef, watch, computed } from 'vue';
import ForceGraph3D from '3d-force-graph';
import { forceRadial } from 'd3-force-3d';
import { usePolling } from '../composables/usePolling.js';

const containerRef = ref(null);
const stats = ref(null);
const error = ref(null);
const hoverNode = ref(null);
const graphRef = shallowRef(null);

const { data: logData }     = usePolling('/api/logs/pb-tail?lines=80', 4_000);
const { data: phaseCurrent } = usePolling('/api/phases/current', 15_000);

const MAX_VISIBLE = 12;
const REVEAL_MS = 800;
const visible = ref([]);
const pbQueue = [];
const seen = new Set();
let lineIdCounter = 0;
let phaseIdx = 0;
let revealTimer = null;

function instToSym(instId) {
  if (!instId) return '';
  const m = instId.match(/^([A-Z0-9]+)-USDT/);
  return m ? m[1] + 'USDT' : instId;
}

const phaseLines = computed(() => {
  const phases = phaseCurrent.value?.phases || [];
  return phases.map((p) => ({
    level: 'INFO',
    src: 'phase_monitor',
    msg: `${instToSym(p.instId).padEnd(10)}  →  ${String(p.phase).padEnd(10)}  ${(Math.round((p.confidence || 0) * 100) + '%').padStart(4)}  vol=${p.vol_regime || '—'}`,
  }));
});

watch(
  logData,
  (nd) => {
    if (!nd?.lines) return;
    for (const l of nd.lines) {
      const key = l.raw || `${l.ts}|${l.msg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pbQueue.push(l);
    }
    if (seen.size > 1000) {
      const arr = [...seen];
      seen.clear();
      arr.slice(-500).forEach((s) => seen.add(s));
    }
  },
  { deep: false },
);

let resizeObs = null;
let rotationTimer = null;
const ACCENT    = '#aacfd1';
const DIM       = '#1a2a2b';
const HIGHLIGHT = '#d0f0f2';
const PARTICLE  = '#aacfd1';

onMounted(async () => {
  try {
    const res = await fetch('/api/architecture/graph', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    stats.value = data.stats;

    const neighbors = new Map();
    for (const n of data.nodes) neighbors.set(n.id, new Set());
    for (const l of data.links) {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      if (!neighbors.has(s)) neighbors.set(s, new Set());
      if (!neighbors.has(t)) neighbors.set(t, new Set());
      neighbors.get(s).add(t);
      neighbors.get(t).add(s);
    }

    const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
    let hoverId = null;

    const el = containerRef.value;
    const graph = ForceGraph3D()(el)
      .backgroundColor('rgba(0,0,0,0)')
      .graphData(data)
      .nodeLabel(() => '')
      .nodeVal(() => 0.5)
      .nodeRelSize(2)
      .nodeColor((n) => {
        if (!hoverId) return ACCENT;
        if (n.id === hoverId) return HIGHLIGHT;
        return neighbors.get(hoverId)?.has(n.id) ? ACCENT : DIM;
      })
      .nodeOpacity(0.9)
      .linkColor(() => ACCENT)
      .linkOpacity(0.18)
      .linkWidth((l) => {
        if (!hoverId) return 0.3;
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        return (s === hoverId || t === hoverId) ? 1.0 : 0.2;
      })
      .linkDirectionalParticles(2)
      .linkDirectionalParticleSpeed(0.004)
      .linkDirectionalParticleWidth(1.0)
      .linkDirectionalParticleColor(() => PARTICLE)
      .onNodeHover((node) => {
        hoverId = node ? node.id : null;
        hoverNode.value = node ? nodeById.get(node.id) : null;
        el.style.cursor = node ? 'pointer' : '';
        graph
          .nodeColor(graph.nodeColor())
          .linkColor(graph.linkColor())
          .linkWidth(graph.linkWidth())
          .linkOpacity(hoverId ? 0.06 : 0.18)
          .linkDirectionalParticleWidth((l) => {
            if (!hoverId) return 1.0;
            const s = typeof l.source === 'object' ? l.source.id : l.source;
            const t = typeof l.target === 'object' ? l.target.id : l.target;
            return (s === hoverId || t === hoverId) ? 2.0 : 0.25;
          });
      });

    graph.showNavInfo(false);

    const SPHERE_R = 95;
    graph.d3Force('charge').strength(-40);
    graph.d3Force('link').distance(20).strength(0.55);
    graph.d3Force('radial', forceRadial(SPHERE_R).strength(0.95));

    // Allow diving deep into the sphere
    const controls = graph.controls();
    if (controls) {
      controls.minDistance = 5;
      controls.maxDistance = 2000;
    }

    graphRef.value = graph;

    // Rotation that preserves user's zoom: only rotate around Y-axis,
    // keep current horizontal radius (derived from user's wheel zoom).
    graph.cameraPosition({ x: 0, y: 0, z: 300 });
    rotationTimer = setInterval(() => {
      if (hoverId) return;
      const cam = graph.cameraPosition();
      const r = Math.hypot(cam.x, cam.z);
      if (r < 0.5) return;
      const theta = Math.atan2(cam.x, cam.z);
      const newTheta = theta + Math.PI / 1400;
      graph.cameraPosition(
        { x: r * Math.sin(newTheta), y: cam.y, z: r * Math.cos(newTheta) },
        undefined,
        0,
      );
    }, 30);

    const resize = () => graph.width(el.clientWidth).height(el.clientHeight);
    resize();
    resizeObs = new ResizeObserver(resize);
    resizeObs.observe(el);

    revealTimer = setInterval(() => {
      let next = null;
      if (pbQueue.length > 0) {
        next = pbQueue.shift();
      } else if (phaseLines.value.length > 0) {
        const list = phaseLines.value;
        next = list[phaseIdx % list.length];
        phaseIdx++;
      }
      if (!next) return;
      visible.value = [...visible.value, { ...next, uid: ++lineIdCounter }];
      if (visible.value.length > MAX_VISIBLE) {
        visible.value = visible.value.slice(-MAX_VISIBLE);
      }
    }, REVEAL_MS);
  } catch (e) {
    console.error(e);
    error.value = e.message || String(e);
  }
});

onBeforeUnmount(() => {
  if (rotationTimer) clearInterval(rotationTimer);
  if (revealTimer) clearInterval(revealTimer);
  if (resizeObs) resizeObs.disconnect();
  if (graphRef.value) {
    try { graphRef.value._destructor?.(); } catch {}
  }
});

function lineOpacity(i, total) {
  if (total <= 1) return 0.9;
  const frac = i / (total - 1);
  return 0.06 + frac * 0.84;
}
</script>

<template>
  <div class="widget a-flow">
    <h3>
      <span>architecture · graph</span>
      <span v-if="stats" style="color:var(--muted);font-size:9px;letter-spacing:1px">
        {{ stats.nodes_total }} nodes · {{ stats.links_total }} links
      </span>
    </h3>
    <div class="body graph-body">
      <div v-if="error" class="bad" style="font-size:10px;padding:8px">err: {{ error }}</div>
      <div ref="containerRef" class="graph-container" />

      <!-- LEFT: streaming log -->
      <div class="left-log">
        <TransitionGroup name="log-line" tag="div" class="log-stream">
          <div
            v-for="(l, i) in visible" :key="l.uid"
            class="log-line"
            :class="[l.level ? l.level.toLowerCase() : '', l.src === 'phase_monitor' ? 'phase' : '']"
            :style="{ opacity: lineOpacity(i, visible.length) }"
          >
            <span class="msg">{{ l.msg || l.raw }}</span>
          </div>
        </TransitionGroup>
      </div>

      <!-- RIGHT: hover card -->
      <transition name="fade">
        <div v-if="hoverNode" class="right-card">
          <div class="card-title">{{ hoverNode.title }}</div>
          <div class="card-meta" v-if="hoverNode.folder">{{ hoverNode.folder }}</div>
          <div class="card-meta" v-else-if="hoverNode.placeholder">PLANNED · not yet written</div>

          <!-- real note: summary -->
          <div class="card-summary" v-if="hoverNode.summary">{{ hoverNode.summary }}</div>

          <!-- placeholder or anyone: backlink context -->
          <div class="card-backlinks" v-if="hoverNode.backlinks_context?.length">
            <div class="bl-head">
              referenced in {{ hoverNode.backlinks_context.length }} note{{ hoverNode.backlinks_context.length === 1 ? '' : 's' }}
            </div>
            <div v-for="(b, i) in hoverNode.backlinks_context" :key="i" class="bl-item">
              <div class="bl-sent">"{{ b.sentence }}"</div>
              <div class="bl-from">— {{ b.from }}</div>
            </div>
          </div>

          <div v-if="!hoverNode.summary && !hoverNode.backlinks_context?.length && hoverNode.placeholder"
               class="card-summary muted">
            упоминается в wiki-ссылке, но нет контекста
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.graph-body { padding: 0; position: relative; overflow: hidden; }
.graph-container { width: 100%; height: 100%; position: absolute; inset: 0; }

/* LEFT streaming log */
.left-log {
  position: absolute; left: 10px; top: 10px; bottom: 10px;
  width: 34%; max-width: 380px;
  pointer-events: none;
  z-index: 2;
  display: flex; flex-direction: column; justify-content: flex-end;
  overflow: hidden;
  font-size: 9px;
  font-family: ui-monospace, 'JetBrains Mono', monospace;
  letter-spacing: 0.3px;
  color: var(--fg);
}
.log-stream { display: flex; flex-direction: column; gap: 2px; }
.log-line {
  line-height: 1.3;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  padding-left: 6px;
  border-left: 1px solid var(--border-hi);
  transition: opacity 0.9s ease, transform 0.9s ease;
}
.log-line.warning { color: var(--phase-creep_up); }
.log-line.error   { color: var(--bad); }
.log-line.phase   { border-left-color: var(--phase-ranging); }
.log-line-enter-from {
  opacity: 0 !important;
  transform: translateY(14px);
}
.log-line-leave-to {
  opacity: 0 !important;
  transform: translateY(-10px);
}
.log-line-leave-active {
  position: absolute;
  width: 100%;
}

/* RIGHT card */
.right-card {
  position: absolute; right: 10px; top: 10px; bottom: 10px;
  width: 28%; max-width: 340px;
  background: rgba(10, 10, 10, 0.88);
  border: 1px solid var(--border-hi);
  padding: 10px 12px;
  z-index: 3;
  display: flex; flex-direction: column; gap: 6px;
  backdrop-filter: blur(6px);
  overflow: hidden;
}
.card-title { font-size: 13px; color: var(--fg); }
.card-meta  { font-size: 9px; color: var(--muted); letter-spacing: 1px; text-transform: uppercase; }
.card-summary { font-size: 10px; color: var(--muted); line-height: 1.45; }
.card-summary.muted { color: var(--muted-2); font-style: italic; }

.card-backlinks { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 7px; }
.bl-head { font-size: 8px; color: var(--muted-2); letter-spacing: 2px; text-transform: uppercase; }
.bl-item { }
.bl-sent { font-size: 10px; color: var(--muted); line-height: 1.4; font-style: italic; }
.bl-from { font-size: 9px; color: var(--muted-2); margin-top: 1px; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter-from,   .fade-leave-to     { opacity: 0; }
</style>
