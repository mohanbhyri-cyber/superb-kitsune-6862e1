export function summarizeBreadth(data, keys, now = Date.now()) {
  const unavailable = { live: false, reason: 'Incomplete or stale NIFTY 50 quotes' };
  if (!Array.isArray(keys) || keys.length !== 50 || new Set(keys).size !== 50) return unavailable;
  const quotes = Object.values(data || {});
  if (quotes.length !== 50) return unavailable;
  const byKey = new Map(quotes.map(q => [q.instrument_token, q]));
  let advances = 0, declines = 0, unchanged = 0, oldest = now;
  for (const key of keys) {
    const q = byKey.get(key);
    const timestamp = Date.parse(q?.timestamp);
    const tradeTime = Number(q?.last_trade_time);
    if (!q || !Number.isFinite(q.last_price) || q.last_price <= 0 ||
        !Number.isFinite(q.prev_close_price) || q.prev_close_price <= 0 ||
        !Number.isFinite(timestamp) || now - timestamp < 0 || now - timestamp > 120000 ||
        !Number.isFinite(tradeTime) || now - tradeTime < 0 || now - tradeTime > 120000) return unavailable;
    oldest = Math.min(oldest, timestamp, tradeTime);
    if (q.last_price > q.prev_close_price) advances++;
    else if (q.last_price < q.prev_close_price) declines++;
    else unchanged++;
  }
  return { live: true, advances, declines, unchanged, coverage: 50, fetchedAt: now,
    oldestQuoteAt: oldest, bias: 'SNAPSHOT' };
}
