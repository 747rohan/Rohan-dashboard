import { ref, onMounted, onUnmounted, watch, toValue } from 'vue';

export function usePolling(url, intervalMs) {
  const data = ref(null);
  const error = ref(null);
  const lastPollTs = ref(null);
  const loading = ref(false);

  let timer = null;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    loading.value = true;
    try {
      const u = toValue(url);
      const res = await fetch(u, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data.value = await res.json();
      error.value = null;
    } catch (e) {
      error.value = e.message || String(e);
    } finally {
      loading.value = false;
      lastPollTs.value = Date.now();
    }
  }

  function start() {
    if (timer) return;
    tick();
    timer = setInterval(tick, intervalMs);
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }
  function onVis() {
    if (document.visibilityState === 'hidden') stop();
    else start();
  }

  if (typeof url !== 'string') {
    watch(() => toValue(url), () => tick());
  }

  onMounted(() => {
    start();
    document.addEventListener('visibilitychange', onVis);
  });
  onUnmounted(() => {
    stopped = true;
    stop();
    document.removeEventListener('visibilitychange', onVis);
  });

  return { data, error, lastPollTs, loading };
}
