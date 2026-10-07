export function candleStatus(time, seconds, now = Date.now()) {
  const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  if (!finite(time) || !finite(seconds) || Number(seconds) <= 0 || !finite(now))
    return { current: false, reason: 'Closed-candle timestamp unavailable' };
  const age = Number(now) / 1000 - Number(time);
  if (age < Number(seconds)) return { current: false, reason: 'Candle not closed yet' };
  if (age > Number(seconds) * 2 + 30)
    return { current: false, reason: 'Closed candle stale' };
  return { current: true, reason: 'Closed-candle data current' };
}
