export function closedDonchian(candles) {
  if (!Array.isArray(candles) || candles.length < 221) return null;
  const index = candles.length - 2;
  const rows = candles.slice(index - 20, index + 1);
  if (rows.some(c => !c || !['open', 'high', 'low', 'close', 'time'].every(
    key => typeof c[key] === 'number' && Number.isFinite(c[key])
  ) || c.low <= 0 || c.high < Math.max(c.open, c.close) ||
    c.low > Math.min(c.open, c.close)) ||
    rows.some((c, i) => i > 0 && c.time <= rows[i - 1].time)) return null;
  const previous = rows.slice(0, -1);
  const current = rows.slice(1);
  const upper = Math.max(...current.map(c => c.high));
  const lower = Math.min(...current.map(c => c.low));
  const close = rows.at(-1).close;
  return { upper, lower, middle: (upper + lower) / 2,
    state: close > Math.max(...previous.map(c => c.high)) ? 'UPSIDE BREAKOUT'
      : close < Math.min(...previous.map(c => c.low)) ? 'DOWNSIDE BREAKOUT' : 'INSIDE RANGE',
    time: rows.at(-1).time };
}
