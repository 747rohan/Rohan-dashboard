#!/bin/sh
# worldmonitor caches into Redis only while its HTTP endpoints are called, and
# the dashboard just reads the wm:* keys. cachedFetch never extends a live key,
# so a key can only be rewritten once it has already expired — run often enough
# that the gap between expiry and refill stays short, and that an upstream
# timeout is retried soon rather than leaving the key missing for minutes.
for p in /api/news/v1/list-feed-digest          /api/market/v1/list-stablecoin-markets          /api/market/v1/list-etf-flows          /api/intelligence/v1/get-risk-scores          /api/prediction/v1/list-prediction-markets; do
  curl -sS -o /dev/null -m 60 "http://127.0.0.1:3000$p" || echo "warm failed: $p"
done
