// Reload the page once a newer build is being served.
//
// The dashboard stays open in tabs for days. After a deploy those tabs keep
// running the old bundle and quietly disagree with everyone who reloaded
// (2026-10-02: the GEX widget showed a different price than the main chart
// in a tab opened before the fix). Vite names the bundle by content hash, so
// comparing the script this page loaded with the one index.html now points
// at is enough to tell.
const BUNDLE = /assets\/index-[\w-]+\.js/;

export function watchForNewBuild(intervalMs = 60_000) {
  const mine = [...document.scripts].map((s) => s.src.match(BUNDLE)?.[0]).find(Boolean);
  if (!mine) return; // vite dev server: no hashed bundle to compare

  let pending = false;
  // A hidden tab is not checked at all (its pollers are paused too); if it
  // goes hidden between the check and the reload, it reloads on coming back.
  const reloadWhenVisible = () => {
    if (document.visibilityState === 'visible') location.reload();
  };

  async function check() {
    if (pending || document.visibilityState === 'hidden') return;
    try {
      const res = await fetch('/', { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) return; // mid-deploy the container is briefly down
      const live = (await res.text()).match(BUNDLE)?.[0];
      if (live && live !== mine) {
        pending = true;
        document.addEventListener('visibilitychange', reloadWhenVisible);
        reloadWhenVisible();
      }
    } catch { /* offline or restarting — try again next round */ }
  }

  setInterval(check, intervalMs);
}
