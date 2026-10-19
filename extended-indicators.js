import { cciSeries } from './cci.js';

const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const valid = c => c && [c.high, c.low, c.close].every(finite) &&
  Number(c.high) >= Number(c.close) && Number(c.close) >= Number(c.low);

// Input must contain only completed candles, oldest first. These are readouts,
// not independent votes or order instructions. No substitute volume is used.
export function extendedIndicators(rows = [], { trustedVolume = false } = {}) {
  const out = { keltner: null, cci: null, mfi: null, cmf: null, obv: null,
    aroonUp: null, aroonDown: null, chop: null };
  if (!Array.isArray(rows) || !rows.length || !rows.every(valid)) return out;
  const n = rows.length;
  const close = rows.map(c => Number(c.close));
  const tr = rows.map((c, i) => i ? Math.max(c.high - c.low,
    Math.abs(c.high - close[i - 1]), Math.abs(c.low - close[i - 1])) : c.high - c.low);
  if (n >= 20) {
    let mid = close.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
    for (let i = 20; i < n; i++) mid += (close[i] - mid) * 2 / 21;
    // Wilder ATR(10), seeded with the first ten true ranges.
    let atr = tr.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    for (let i = 10; i < n; i++) atr = (atr * 9 + tr[i]) / 10;
    out.keltner = { mid, upper: mid + 2 * atr, lower: mid - 2 * atr };
    out.cci = cciSeries(rows, 20).at(-1);
  }
  // Aroon(25): 25 elapsed periods require the current bar plus 25 prior bars.
  // Equal extrema use their most recent occurrence.
  if (n >= 26) {
    const w = rows.slice(-26);
    let hi = 0, lo = 0;
    for (let i = 1; i < w.length; i++) {
      if (Number(w[i].high) >= Number(w[hi].high)) hi = i;
      if (Number(w[i].low) <= Number(w[lo].low)) lo = i;
    }
    out.aroonUp = 100 * hi / 25;
    out.aroonDown = 100 * lo / 25;
  }
  if (n >= 15) {
    const w = rows.slice(-14);
    const range = Math.max(...w.map(c => Number(c.high))) - Math.min(...w.map(c => Number(c.low)));
    const sum = tr.slice(-14).reduce((a, b) => a + b, 0);
    if (range > 0 && sum > 0) out.chop = 100 * Math.log10(sum / range) / Math.log10(14);
  }
  const volumeValid = w => trustedVolume && w.every(c => finite(c.volume) && Number(c.volume) >= 0);
  const typical = c => (Number(c.high) + Number(c.low) + Number(c.close)) / 3;
  if (n >= 15 && volumeValid(rows.slice(-14))) {
    let pos = 0, neg = 0;
    for (let i = n - 14; i < n; i++) {
      const t = typical(rows[i]), p = typical(rows[i - 1]), flow = t * Number(rows[i].volume);
      if (t > p) pos += flow;
      if (t < p) neg += flow;
    }
    if (pos + neg > 0) out.mfi = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  }
  if (n >= 20 && volumeValid(rows.slice(-20))) {
    let flow = 0, volume = 0;
    for (const c of rows.slice(-20)) {
      const v = Number(c.volume), range = c.high - c.low;
      volume += v; // Flat candles still contribute volume; multiplier is zero.
      if (range > 0) flow += ((2 * c.close - c.low - c.high) / range) * v;
    }
    if (volume > 0) out.cmf = flow / volume;
  }
  if (n >= 2 && volumeValid(rows) && rows.some(c => Number(c.volume) > 0)) {
    out.obv = 0; // Zero baseline over the supplied history; no invented earlier OBV.
    for (let i = 1; i < n; i++) out.obv += Math.sign(close[i] - close[i - 1]) * Number(rows[i].volume);
  }
  return out;
}

// Floor pivots from an explicitly supplied previous session OHLC.
export function sessionPivots(rows = []) {
  if (!rows.length || !rows.every(valid)) return null;
  const high = Math.max(...rows.map(c => Number(c.high)));
  const low = Math.min(...rows.map(c => Number(c.low)));
  const close = Number(rows.at(-1).close), pivot = (high + low + close) / 3;
  const bc = (high + low) / 2, tc = 2 * pivot - bc;
  return { pivot, bc: Math.min(bc, tc), tc: Math.max(bc, tc),
    r1: 2 * pivot - low, s1: 2 * pivot - high,
    r2: pivot + high - low, s2: pivot - high + low,
    r3: high + 2 * (pivot - low), s3: low - 2 * (high - pivot) };
}

// A session level is complete only when every expected candle is present.
// Dated rows are produced in IST by the caller. Never infer 15-minute highs
// from an hourly/daily candle that contains prices outside the opening range.
export function completeSessionWindow(dated, startMinute, endMinute, seconds) {
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > (endMinute - startMinute) * 60) return false;
  const step = seconds / 60;
  const expected = Math.ceil((endMinute - startMinute) / step);
  return dated.length === expected && dated.every((row, i) =>
    row.minutes === startMinute + i * step && valid(row.candle) &&
    (i === 0 || Number(row.candle.time) - Number(dated[i - 1].candle.time) === seconds));
}
