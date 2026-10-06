const valid = v => typeof v === 'number' && Number.isFinite(v);
const ohlc = c => c && [c.time, c.high, c.low, c.close].every(valid) &&
  c.low > 0 && c.high >= c.low && c.close >= c.low && c.close <= c.high;
const istDate = time => new Date((time + 19800) * 1000).toISOString().slice(0, 10);
const minute = time => ((time + 19800) % 86400) / 60;

export function marketMapExtras(candles, seconds) {
  const result = { atr: null, cci: null, pivots: null, time: null };
  if (!Array.isArray(candles) || candles.length < 2) return result;
  // Normalized app data always ends with a forming/synthetic candle.
  const closed = candles.slice(0, -1);
  const last = closed.at(-1);
  if (!ohlc(last)) return result;
  result.time = last.time;

  const recent = closed.slice(-15);
  if (recent.length === 15 && recent.every(ohlc)) {
    let atr = null;
    let seed = 0;
    let count = 0;
    for (let i = 1; i < closed.length; i++) {
      const c = closed[i], p = closed[i - 1];
      if (!ohlc(c) || !ohlc(p) || c.time <= p.time) {
        atr = null; seed = 0; count = 0; continue;
      }
      const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
      if (atr === null) { seed += tr; count++; if (count === 14) atr = seed / 14; }
      else atr = (atr * 13 + tr) / 14;
    }
    if (valid(atr)) result.atr = { points: atr, percent: atr / last.close * 100, distance: atr * 1.5 };
  }

  const window = closed.slice(-20);
  if (window.length === 20 && window.every(ohlc) && window.every((c, i) => !i || c.time > window[i - 1].time)) {
    const prices = window.map(c => (c.high + c.low + c.close) / 3);
    const mean = prices.reduce((a, b) => a + b, 0) / 20;
    const deviation = prices.reduce((a, b) => a + Math.abs(b - mean), 0) / 20;
    const value = deviation === 0 ? 0 : (prices.at(-1) - mean) / (0.015 * deviation);
    if (valid(value)) result.cci = { value, state: value > 100 ? 'ABOVE +100' : value < -100 ? 'BELOW -100' : 'BETWEEN -100 AND +100' };
  }

  if (!valid(seconds) || seconds <= 0) return result;
  const currentDate = istDate(last.time);
  const previousDate = closed.filter(c => valid(c?.time) && istDate(c.time) < currentDate).map(c => istDate(c.time)).sort().at(-1);
  if (!previousDate) return result;
  const session = closed.filter(c => valid(c?.time) && istDate(c.time) === previousDate && minute(c.time) >= 555 && minute(c.time) < 930);
  // Never calculate daily pivots from a partial intraday window.
  if (!session.length || !session.every(ohlc) || minute(session[0].time) !== 555 ||
      minute(session.at(-1).time) + seconds / 60 < 930 ||
      !session.every((c, i) => !i || c.time - session[i - 1].time === seconds)) return result;
  const h = Math.max(...session.map(c => c.high));
  const l = Math.min(...session.map(c => c.low));
  const p = (h + l + session.at(-1).close) / 3;
  result.pivots = { date: previousDate, p, r1: 2 * p - l, s1: 2 * p - h,
    r2: p + h - l, s2: p - h + l };
  return result;
}

export function renderMarketMapExtras(candles, seconds, expectedTime, root = document) {
  const data = marketMapExtras(candles, seconds);
  const sameTime = valid(expectedTime) && data.time === expectedTime;
  const fmt = v => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const set = (id, text) => { const el = root.getElementById(id); if (el) el.textContent = text; };
  set('market-map-atr-detail', sameTime && data.atr
    ? `${fmt(data.atr.points)} pts / ${data.atr.percent.toFixed(2)}% · 1.5× distance ${fmt(data.atr.distance)} pts`
    : 'WAIT · insufficient closed candles');
  set('market-map-cci', sameTime && data.cci ? `${data.cci.value.toFixed(2)} · ${data.cci.state}` : 'WAIT · 20 valid closed candles required');
  set('market-map-pivots', sameTime && data.pivots ? `P ${fmt(data.pivots.p)} · ${data.pivots.date}` : 'WAIT · complete previous session required');
  set('market-map-pivot-support', sameTime && data.pivots ? `S1 ${fmt(data.pivots.s1)} / S2 ${fmt(data.pivots.s2)}` : '—');
  set('market-map-pivot-resistance', sameTime && data.pivots ? `R1 ${fmt(data.pivots.r1)} / R2 ${fmt(data.pivots.r2)}` : '—');
}
