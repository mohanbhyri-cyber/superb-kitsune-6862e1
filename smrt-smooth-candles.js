// Original SMRT display indicator. Causal EMA smoothing; never used for orders.
export function smoothCandles(candles, period = 8) {
  if (!Array.isArray(candles) || !Number.isInteger(period) || period < 1 || period > 100) return [];
  const keys = ['time', 'open', 'high', 'low', 'close'];
  if (candles.some((c, i) => keys.some(k => c?.[k] == null || c[k] === '' || !Number.isFinite(Number(c[k]))) ||
    Number(c.high) < Math.max(Number(c.open), Number(c.close)) || Number(c.low) > Math.min(Number(c.open), Number(c.close)) ||
    (i > 0 && Number(c.time) <= Number(candles[i - 1].time)))) return [];
  const alpha = 2 / (period + 1);
  let previous;
  return candles.map(c => {
    const bar = {time: Number(c.time)};
    for (const key of keys.slice(1)) bar[key] = previous ? alpha * Number(c[key]) + (1 - alpha) * previous[key] : Number(c[key]);
    bar.high = Math.max(bar.high, bar.open, bar.close);
    bar.low = Math.min(bar.low, bar.open, bar.close);
    const direction = previous ? Math.sign(bar.close - previous.close) : Math.sign(bar.close - bar.open);
    const color = direction > 0 ? '#72e4bd' : direction < 0 ? '#f17c86' : '#94a3b8';
    previous = bar;
    return {...bar, color, borderColor: color, wickColor: color};
  });
}

