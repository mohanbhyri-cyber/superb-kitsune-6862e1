// Commodity Channel Index: typical price, 20-period mean and mean deviation.
export function cciSeries(candles, period = 20) {
  if (!Array.isArray(candles)) return [];
  const out = Array(candles.length).fill(null);
  if (!Number.isInteger(period) || period < 2) return out;
  const typical = candles.map(c => {
    const values = [c?.high, c?.low, c?.close];
    if (!values.every(v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)))) return null;
    const [high, low, close] = values.map(Number);
    return high >= low && close >= low && close <= high ? (high + low + close) / 3 : null;
  });
  for (let i = period - 1; i < typical.length; i++) {
    const window = typical.slice(i - period + 1, i + 1);
    if (!window.every(Number.isFinite)) continue;
    const mean = window.reduce((sum, v) => sum + v, 0) / period;
    const deviation = window.reduce((sum, v) => sum + Math.abs(v - mean), 0) / period;
    out[i] = deviation === 0 ? 0 : (typical[i] - mean) / (0.015 * deviation);
  }
  return out;
}
