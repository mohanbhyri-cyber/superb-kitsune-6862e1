import { nseCandleBucket, nseSessionBounds } from './nse-candle-time.js';

export const HISTORICAL_MIN_DATE = '2022-01-01';
const DAY = 86400000;
const CONFIG = {
  '1m': { unit: 'minutes', interval: 1, seconds: 60, days: 7 },
  '3m': { unit: 'minutes', interval: 3, seconds: 180, days: 7 },
  '5m': { unit: 'minutes', interval: 5, seconds: 300, days: 10 },
  '15m': { unit: 'minutes', interval: 15, seconds: 900, days: 21 },
  '1h': { unit: 'hours', interval: 1, seconds: 3600, days: 60 }
};

export function historicalDateLimit(now = Date.now()) {
  // Calendar arithmetic in IST, independent of the browser/host timezone.
  return new Date(now + 19800000 - DAY).toISOString().slice(0, 10);
}

export function validateHistoricalDate(date, now = Date.now()) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date + 'T00:00:00Z')) ||
      new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) {
    throw new Error('Choose a valid historical date.');
  }
  if (date < HISTORICAL_MIN_DATE || date > historicalDateLimit(now)) {
    throw new Error('Choose a past date from 1 January 2022 through yesterday (IST).');
  }
  return date;
}

export function historicalISTDate(time) {
  return new Date(Number(time) * 1000 + 19800000).toISOString().slice(0, 10);
}

export function selectHistoricalSession(rows, date, timeframe) {
  const config = CONFIG[timeframe];
  if (!config) throw new Error('Unsupported historical timeframe.');
  const byTime = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!Array.isArray(row) || row.length < 6 ||
        row.slice(1, 6).some(x => x === null || x === '' || !Number.isFinite(Number(x)))) continue;
    const time = Date.parse(row[0]) / 1000;
    if (!Number.isFinite(time) || nseCandleBucket(time, config.seconds) !== time) continue;
    const session = nseSessionBounds(time);
    if (time + config.seconds > session.close) continue;
    const candleDate = historicalISTDate(time);
    if (candleDate < HISTORICAL_MIN_DATE || candleDate > date) continue;
    const [open, high, low, close, volume] = row.slice(1, 6).map(Number);
    if (Math.min(open, high, low, close) <= 0 || volume < 0 ||
        high < Math.max(open, close, low) || low > Math.min(open, close, high)) continue;
    byTime.set(time, { time, open, high, low, close, volume });
  }
  const ordered = [...byTime.values()].sort((a, b) => a.time - b.time);
  const before = ordered.filter(c => historicalISTDate(c.time) < date).slice(-220);
  const session = ordered.filter(c => historicalISTDate(c.time) === date);
  return { candles: [...before, ...session], firstSessionIndex: before.length,
    sessionCount: session.length, warmupCount: before.length };
}

export function historicalReplayData(payload, date, timeframe) {
  if (payload?.historical !== true || payload.live !== false || payload.available !== true ||
      payload.date !== date || payload.timeframe !== timeframe || payload.symbol !== 'NIFTY') {
    throw new Error('The historical response does not match the selected session.');
  }
  const select = (candles, frame) => selectHistoricalSession(
    (Array.isArray(candles) ? candles : []).filter(c =>
      c && Number.isFinite(c.time) && c.time > 0 && c.time < 1e12).map(c =>
      [new Date(c.time * 1000).toISOString(), c.open, c.high, c.low, c.close, c.volume]), date, frame);
  const main = select(payload.candles, timeframe);
  if (!main.sessionCount) throw new Error('No valid candles for the selected historical date.');
  return { ...main, mtf: Object.fromEntries(['5m', '15m', '1h'].map(frame =>
    [frame, select(payload.mtf?.[frame], frame).candles])) };
}

// One selected day, with sequential, bounded requests. No current/intraday
// fallback, no date guessing, and no request after a broker/controller failure.
export async function loadHistoricalSession({ symbol, timeframe, date, instrumentKey,
  now = Date.now(), fetchCandles }) {
  validateHistoricalDate(date, now);
  if (!['1m', '3m', '5m', '15m'].includes(timeframe) || !instrumentKey) {
    throw new Error('Unsupported historical instrument or timeframe.');
  }
  const frames = {}, requested = [...new Set([timeframe, '5m', '15m', '1h'])];
  for (const frame of requested) {
    const config = CONFIG[frame];
    const from = new Date(Math.max(Date.parse(HISTORICAL_MIN_DATE + 'T00:00:00Z'),
      Date.parse(date + 'T00:00:00Z') - config.days * DAY)).toISOString().slice(0, 10);
    const endpoint = 'https://api.upstox.com/v3/historical-candle/' +
      encodeURIComponent(instrumentKey) + '/' + config.unit + '/' + config.interval + '/' + date + '/' + from;
    const body = await fetchCandles(endpoint);
    const selected = selectHistoricalSession(body?.data?.candles, date, frame);
    if (frame === timeframe && !selected.sessionCount) {
      return { available: false, live: false, historical: true, symbol, timeframe, date,
        candles: [], reason: 'No regular-session candles returned for this date. It may be a holiday or historical data may be unavailable.' };
    }
    frames[frame] = selected;
  }
  const main = frames[timeframe];
  return { available: true, historical: true, live: false, source: 'UPSTOX',
    symbol, timeframe, date, ...main,
    mtf: Object.fromEntries(['5m', '15m', '1h'].map(frame => [frame, frames[frame].candles])),
    warning: 'HISTORICAL — NOT LIVE. Signals are recalculated from visible completed candles. Missing historical confirmations remain WAIT; this is not a performance backtest.' };
}
