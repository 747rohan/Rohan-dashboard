const MAX_CACHE = 500;
const cache = new Map(); // en → ru

// Google Translate's Chrome dictionary client. The `gtx` endpoint this used to
// call answers the AWS host with 429 on every request; this one does not, and
// it takes many `q` in one GET, returning the translations in the same order.
const ENDPOINT = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=ru';
const MAX_QS = 1800; // encoded query length per request, well under URL limits

const BACKOFF_MIN = 15 * 60_000;
const BACKOFF_MAX = 2 * 3600_000;
let backoff = BACKOFF_MIN;
let restUntil = 0;
let job = null;

function remember(en, ru) {
  cache.set(en, ru);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
}

function chunk(texts) {
  const out = [];
  let cur = [];
  let len = 0;
  for (const t of texts) {
    const n = encodeURIComponent(t).length + 3;
    if (cur.length && len + n > MAX_QS) { out.push(cur); cur = []; len = 0; }
    cur.push(t);
    len += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function fetchChunk(texts) {
  const qs = texts.map((t) => `q=${encodeURIComponent(t)}`).join('&');
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${ENDPOINT}&${qs}`, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    // One string per q; with source detection each would be [text, lang].
    const arr = (Array.isArray(j) ? j : [j]).map((x) => (Array.isArray(x) ? x[0] : x));
    if (arr.length !== texts.length) throw new Error(`got ${arr.length} translations for ${texts.length}`);
    return arr;
  } finally {
    clearTimeout(to);
  }
}

async function translateMissing(texts) {
  for (const part of chunk(texts)) {
    const ru = await fetchChunk(part);
    part.forEach((en, i) => remember(en, typeof ru[i] === 'string' && ru[i] ? ru[i] : en));
  }
}

// Cached translations come back at once; missing ones are fetched in one
// background request per ~1.8 kB of text, and the caller waits for that at
// most `waitMs`. Anything not ready yet is returned in English and shows up
// translated on a later poll. After a failure the translator rests, doubling
// the pause up to two hours — retrying every headline on every poll is what
// kept the news feed at 14 s while the old endpoint answered 429.
export async function translateBatch(texts, { waitMs = 3000 } = {}) {
  const missing = [...new Set(texts.filter((t) => t && !cache.has(t)))];
  if (missing.length && !job && Date.now() >= restUntil) {
    job = translateMissing(missing)
      .then(() => { backoff = BACKOFF_MIN; })
      .catch((e) => {
        restUntil = Date.now() + backoff;
        console.warn(`[translate] ${e.message}; pausing ${Math.round(backoff / 60_000)} min`);
        backoff = Math.min(backoff * 2, BACKOFF_MAX);
      })
      .finally(() => { job = null; });
  }
  if (job) await Promise.race([job, new Promise((r) => setTimeout(r, waitMs))]);
  return texts.map((t) => cache.get(t) ?? t);
}
