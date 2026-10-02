import { ref, onMounted, onUnmounted } from 'vue';

// One live BTC price for the whole page. The main chart and the GEX widget
// both show it; two independent 1 s pollers would tick up to a second apart
// and double the requests, so they share this one.
const tick = ref(null);
const error = ref(null);

let users = 0;
let timer = null;
let inflight = false;

async function poll() {
  if (inflight) return; // a slow response must not stack up behind the next
  inflight = true;
  try {
    const res = await fetch('/api/btc/tick', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    tick.value = await res.json();
    error.value = null;
  } catch (e) {
    error.value = e.message || String(e);
  } finally {
    inflight = false;
  }
}

function start() {
  if (timer) return;
  poll();
  timer = setInterval(poll, 1_000);
}
function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}
function onVis() {
  if (document.visibilityState === 'hidden') stop();
  else if (users > 0) start();
}

export function useBtcTick() {
  onMounted(() => {
    if (users++ === 0) {
      start();
      document.addEventListener('visibilitychange', onVis);
    }
  });
  onUnmounted(() => {
    if (--users === 0) {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    }
  });
  return { tick, error };
}
