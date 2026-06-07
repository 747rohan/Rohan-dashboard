const MAX_CACHE = 500;
const cache = new Map(); // en → ru

function evictOldest() {
  if (cache.size <= MAX_CACHE) return;
  const first = cache.keys().next().value;
  cache.delete(first);
}

export async function translateToRu(text) {
  if (!text) return text;
  const cached = cache.get(text);
  if (cached) return cached;

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ru&dt=t&q=${encodeURIComponent(text)}`;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(to);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const translated = j?.[0]?.map((s) => s[0]).join('') || text;
    cache.set(text, translated);
    evictOldest();
    return translated;
  } catch (e) {
    return text;
  }
}

export async function translateBatch(texts) {
  const results = [];
  for (const t of texts) {
    results.push(await translateToRu(t));
    if (!cache.has(t)) await new Promise((r) => setTimeout(r, 100));
  }
  return results;
}
