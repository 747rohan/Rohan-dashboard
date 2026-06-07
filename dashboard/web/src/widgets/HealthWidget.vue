<script setup>
import { computed } from 'vue';
import { usePolling } from '../composables/usePolling.js';

const { data, error, lastPollTs } = usePolling('/api/health', 2000);

const status = computed(() => {
  if (error.value) return { label: 'DISCONNECTED', cls: 'bad' };
  if (data.value?.ok) return { label: 'CONNECTED', cls: 'ok' };
  return { label: '...', cls: '' };
});

const uptime = computed(() => {
  const s = data.value?.uptime;
  if (typeof s !== 'number') return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  return `${h}h ${m}m ${ss}s`;
});

const lastPoll = computed(() =>
  lastPollTs.value ? new Date(lastPollTs.value).toLocaleTimeString() : '—',
);
</script>

<template>
  <div class="widget">
    <h3>// health</h3>
    <div class="kv">
      <span class="k">status</span><span :class="status.cls">{{ status.label }}</span>
      <span class="k">uptime</span><span>{{ uptime }}</span>
      <span class="k">last poll</span><span>{{ lastPoll }}</span>
      <span class="k">error</span><span class="bad">{{ error || '—' }}</span>
    </div>
  </div>
</template>
