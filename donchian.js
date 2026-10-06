// Donchian Channel calculated from completed candles only.
// The final array element is treated as the live/forming candle.
export function closedDonchian(candles, period = 20) {
  if (!Array.isArray(candles) || !Number.isInteger(period) || period < 2) {
    return null;
  }

  // Need `period` prior closed candles + the closed candle being tested
  // + one live/forming candle that must never enter the calculation.
  if (candles.length < period + 2) {
    return null;
  }

  const index = candles.length - 2;
  const rows = candles.slice(index - period, index + 1);

  if (rows.length !== period + 1) {
    return null;
  }

  const valid = rows.every((c, i) => {
    if (!c || !['open', 'high', 'low', 'close', 'time'].every(
      key => typeof c[key] === 'number' && Number.isFinite(c[key])
    )) {
      return false;
    }

    if (
      c.low <= 0 ||
      c.high < c.low ||
      c.high < Math.max(c.open, c.close) ||
      c.low > Math.min(c.open, c.close)
    ) {
      return false;
    }

    return i === 0 || c.time > rows[i - 1].time;
  });

  if (!valid) {
    return null;
  }

  // `previous` is the channel that existed before the latest closed candle.
  // Breakout tests must use this prior channel to avoid comparing the close
  // against a high/low from the same candle.
  const previous = rows.slice(0, period);
  const current = rows.slice(1);
  const latest = rows.at(-1);

  const previousUpper = Math.max(...previous.map(c => c.high));
  const previousLower = Math.min(...previous.map(c => c.low));
  const upper = Math.max(...current.map(c => c.high));
  const lower = Math.min(...current.map(c => c.low));

  const state = latest.close > previousUpper
    ? 'UPSIDE BREAKOUT'
    : latest.close < previousLower
      ? 'DOWNSIDE BREAKOUT'
      : 'INSIDE RANGE';

  return {
    period,
    upper,
    lower,
    middle: (upper + lower) / 2,
    previousUpper,
    previousLower,
    state,
    side: state === 'UPSIDE BREAKOUT' ? 1 : state === 'DOWNSIDE BREAKOUT' ? -1 : 0,
    time: latest.time
  };
}
