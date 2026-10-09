// Market clock utilities. Do not infer exchange candle timestamps from local time.
// A server-provided Date header can estimate clock offset, but network latency
// introduces uncertainty; this is a guard, not an authoritative exchange clock.
let offsetMs = null;
let uncertaintyMs = Infinity;
export function observeServerDate(dateHeader, sentAtMs, receivedAtMs) {
  const serverMs = Date.parse(dateHeader || '');
  if (![serverMs, sentAtMs, receivedAtMs].every(Number.isFinite) ||
      receivedAtMs < sentAtMs) return false;
  const rttMs = receivedAtMs - sentAtMs;
  // HTTP Date is often rounded to whole seconds.
  const estimate = serverMs - (sentAtMs + receivedAtMs) / 2;
  const uncertainty = rttMs / 2 + 1000;
  if (offsetMs === null || uncertainty < uncertaintyMs) {
    offsetMs = estimate;
    uncertaintyMs = uncertainty;
  }
  return true;
}
export function marketNowMs(localNowMs = Date.now()) {
  return localNowMs + (offsetMs ?? 0);
}
export function clockStatus(localNowMs = Date.now()) {
  return {
    synchronized: offsetMs !== null,
    offsetMs,
    uncertaintyMs: Number.isFinite(uncertaintyMs) ? uncertaintyMs : null,
    // Fail closed when clock uncertainty is too high to confirm live signals.
    safeForLiveSignals: offsetMs !== null && uncertaintyMs <= 1500 &&
      Math.abs(offsetMs) <= 30000,
    observedAtMs: localNowMs
  };
}
export function isClosedCandle(candleStartSeconds, timeframeSeconds, nowMs = marketNowMs()) {
  return Number.isFinite(candleStartSeconds) &&
    Number.isFinite(timeframeSeconds) && timeframeSeconds > 0 &&
    Number.isFinite(nowMs) &&
    (candleStartSeconds + timeframeSeconds) * 1000 <= nowMs;
}
