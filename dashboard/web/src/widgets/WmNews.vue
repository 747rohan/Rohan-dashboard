<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { usePolling } from '../composables/usePolling.js';

const { data, error } = usePolling('/api/wm/feed', 15_000);

const block = computed(() => data.value?.data?.news);
const items = computed(() => {
  const v = block.value?.value;
  if (!Array.isArray(v)) return [];
  return v;
});

const ttlStr = (ttl) => {
  if (ttl == null) return '';
  if (ttl <= 0) return 'expired';
  if (ttl < 60) return `${ttl}s`;
  return `${Math.floor(ttl / 60)}m`;
};

const threatColor = (lvl) => ({
  LOW:      'var(--ok)',
  MEDIUM:   'var(--phase-creep_up)',
  HIGH:     'var(--phase-downtrend)',
  CRITICAL: 'var(--bad)',
}[lvl] || 'var(--muted-2)');

// Auto-scroll: slowly scroll down, pause on hover
const listRef = ref(null);
const paused = ref(false);
let scrollTimer = null;
let waitingReset = false;

onMounted(() => {
  // skip auto-scroll on touch devices (viewport auto-scaled, whole page visible)
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (isTouch) return;
  scrollTimer = setInterval(() => {
    const el = listRef.value;
    if (!el || paused.value || waitingReset) return;
    if (el.scrollTop >= el.scrollHeight - el.clientHeight - 2) {
      waitingReset = true;
      setTimeout(() => {
        if (el) {
          el.style.scrollBehavior = 'auto';
          el.scrollTop = 0;
          el.style.scrollBehavior = '';
        }
        waitingReset = false;
      }, 1200);
      return;
    }
    el.scrollTop += 0.5;
  }, 30);
});
onUnmounted(() => { if (scrollTimer) clearInterval(scrollTimer); });
</script>

<template>
  <div class="widget a-news">
    <h3>
      <span>news · wm</span>
      <span v-if="block" style="color:var(--muted);font-size:9px;letter-spacing:1px">
        ttl {{ ttlStr(block.ttl) }}
        <span v-if="block.stale" style="color:var(--phase-creep_up);margin-left:4px">cached</span>
      </span>
    </h3>
    <div class="body">
      <div v-if="error" class="bad" style="font-size:10px">err: {{ error }}</div>
      <div v-else-if="!block">loading…</div>
      <div v-else-if="block.empty || !items.length" class="placeholder" style="font-size:10px">
        empty · key expired
      </div>
      <div
        v-else
        ref="listRef"
        class="news-scroll"
        @mouseenter="paused = true"
        @mouseleave="paused = false"
      >
        <div v-for="(n, i) in items" :key="i" class="news-item">
          <div class="news-top">
            <span class="badge" :style="{background: threatColor(n.threat?.level)}">{{ n.threat?.level || '?' }}</span>
            <span v-if="n.threat?.confidence" class="conf">{{ Math.round(n.threat.confidence * 100) }}%</span>
          </div>
          <div class="news-text">{{ n.headline_ru || n.headline }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.news-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: hidden;
  display: flex;
  flex-direction: column;
  gap: 6px;
  mask-image: linear-gradient(to bottom, transparent 0%, black 8%, black 88%, transparent 100%);
  padding: 6px 0;
  scroll-behavior: smooth;
}
.news-scroll:hover {
  overflow-y: auto;
}

.news-item {
  padding: 5px 6px;
  border-left: 2px solid var(--border-hi);
  transition: border-color 0.3s ease, background 0.3s ease;
  flex: none;
}
.news-item:hover {
  border-left-color: var(--accent-60);
  background: rgba(var(--ar), var(--ag), var(--ab), 0.03);
}

.news-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}
.badge {
  font-size: 7px;
  padding: 1px 5px;
  letter-spacing: 1.5px;
  color: #000;
  text-transform: uppercase;
  font-weight: 600;
}
.conf {
  font-size: 8px;
  color: var(--muted);
}

.news-text {
  font-size: 10px;
  line-height: 1.4;
  color: var(--fg);
  opacity: 0.85;
}
.news-item:hover .news-text {
  opacity: 1;
}

/* custom scrollbar on hover */
.news-scroll::-webkit-scrollbar { width: 3px; }
.news-scroll::-webkit-scrollbar-track { background: transparent; }
.news-scroll::-webkit-scrollbar-thumb { background: var(--border-hi); border-radius: 2px; }
</style>
