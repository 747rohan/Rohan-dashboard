<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { usePolling } from '../composables/usePolling.js';

const { data, error } = usePolling('/api/processes', 5000);

const W = 1200;
const H = 170;
const COL_W = 240;
const ROW_H = 22;
const NODE_W = 150;
const NODE_H = 16;
const PAD_X = 16;
const PAD_Y = 12;

function nodePos(n) {
  const x = PAD_X + n.col * COL_W;
  const y = PAD_Y + (n.row - 1) * ROW_H;
  return { x, y, cx: x + NODE_W / 2, cy: y + NODE_H / 2 };
}

const graph = computed(() => {
  const nodes = data.value?.nodes || [];
  const edges = data.value?.edges || [];
  const byId = new Map(nodes.map((n) => [n.id, { ...n, ...nodePos(n) }]));
  const lines = edges
    .map((e) => {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) return null;
      const x1 = a.x + NODE_W;
      const y1 = a.cy;
      const x2 = b.x;
      const y2 = b.cy;
      return { ...e, x1, y1, x2, y2, fromNode: a, toNode: b };
    })
    .filter(Boolean);
  return { nodes: [...byId.values()], edges: lines };
});

// Animated pings: for each edge with a live ping source, emit periodic pulses.
const tick = ref(0);
let timer = null;
onMounted(() => {
  timer = setInterval(() => { tick.value = (tick.value + 1) % 3600; }, 50);
});
onUnmounted(() => { if (timer) clearInterval(timer); });

function pingPos(edge, idx) {
  const nodes = graph.value.nodes;
  const pingNode = nodes.find((n) => n.id === edge.ping);
  if (!pingNode || pingNode.status !== 'active') return null;
  const ageS = Math.max(0, pingNode.age_s ?? 0);
  // period: fresher source -> faster pulses; baseline 4s period
  const periodMs = Math.max(1500, Math.min(6000, (ageS + 1) * 500));
  const t = ((Date.now() + idx * 700) % periodMs) / periodMs;
  return {
    cx: edge.x1 + (edge.x2 - edge.x1) * t,
    cy: edge.y1 + (edge.y2 - edge.y1) * t,
  };
}

const statusColor = (s) => ({
  active:   'var(--ok)',
  stale:    'var(--phase-creep_up)',
  inactive: 'var(--bad)',
  unknown:  'var(--muted-2)',
}[s] || 'var(--muted-2)');

function ageFmt(s) {
  if (s == null) return '';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}
</script>

<template>
  <div class="widget a-flow">
    <h3>
      <span>// process flow</span>
      <span v-if="data" style="color:var(--muted);font-size:9px;letter-spacing:1px">
        {{ data.nodes.filter(n => n.status === 'active').length }} / {{ data.nodes.length }} active
      </span>
    </h3>
    <div class="body">
      <div v-if="error" class="bad" style="font-size:10px">err: {{ error }}</div>
      <div v-else-if="!data">loading…</div>
      <svg v-else :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%">
        <!-- edges -->
        <g>
          <line
            v-for="(e, i) in graph.edges" :key="'e'+i"
            :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2"
            :stroke="e.ping && graph.nodes.find(n => n.id === e.ping)?.status === 'active' ? 'var(--accent)' : 'var(--border-hi)'"
            :stroke-opacity="e.ping ? 0.7 : 0.3"
            stroke-width="0.6"
          />
        </g>
        <!-- pings -->
        <g>
          <template v-for="(e, i) in graph.edges" :key="'p'+i">
            <circle
              v-if="pingPos(e, i) && tick >= 0"
              :cx="pingPos(e, i).cx"
              :cy="pingPos(e, i).cy"
              r="1.8"
              fill="var(--accent)"
            />
          </template>
        </g>
        <!-- nodes -->
        <g>
          <g v-for="n in graph.nodes" :key="n.id">
            <rect
              :x="n.x" :y="n.y" :width="NODE_W" :height="NODE_H"
              fill="var(--panel)"
              :stroke="statusColor(n.status)"
              stroke-width="0.8"
            />
            <circle
              :cx="n.x + 6" :cy="n.cy" r="2.5"
              :fill="statusColor(n.status)"
            />
            <text
              :x="n.x + 12" :y="n.cy + 3"
              fill="var(--fg)" font-size="9" font-family="ui-monospace,monospace"
            >{{ n.label }}</text>
            <text
              v-if="n.age_s != null"
              :x="n.x + NODE_W - 4" :y="n.cy + 3"
              text-anchor="end"
              fill="var(--muted)" font-size="8"
            >{{ ageFmt(n.age_s) }}</text>
          </g>
        </g>
        <!-- legend -->
        <g :transform="`translate(${PAD_X}, ${H - 8})`">
          <g v-for="(st, i) in ['active', 'stale', 'inactive', 'unknown']" :key="st" :transform="`translate(${i * 80}, 0)`">
            <circle cx="3" cy="-2" r="2.5" :fill="statusColor(st)" />
            <text x="10" y="1" fill="var(--muted)" font-size="8">{{ st }}</text>
          </g>
        </g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.body { padding: 0; }
</style>
