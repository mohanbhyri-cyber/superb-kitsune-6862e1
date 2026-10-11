import { nseSessionBounds, nseCandleBucket } from './nse-candle-time.js';
import { regularNseHours } from './options-context.js';

const finite = value => (typeof value === 'number' ||
  (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));
const positive = value => finite(value) && Number(value) > 0;
const supported = seconds => [60, 180, 300, 900].includes(Number(seconds));

// Only genuine completed, aligned regular-session bars may enter confirmation.
// The existing endpoint's live/forming VWAP remains a display value only.
export function completedFuturesCandles(candles, seconds, now) {
  if (!Array.isArray(candles) || !supported(seconds) || !positive(now)) return [];
  const session = nseSessionBounds(now);
  return candles.filter(c => positive(c?.time) &&
    nseSessionBounds(c.time)?.open === session.open &&
    nseCandleBucket(c.time, seconds) === Number(c.time) &&
    Number(c.time) + Number(seconds) <= Math.min(Number(now), session.close) &&
    [c.open, c.high, c.low, c.close].every(positive) &&
    Number(c.high) >= Math.max(Number(c.open), Number(c.close), Number(c.low)) &&
    Number(c.low) <= Math.min(Number(c.open), Number(c.close)) &&
    finite(c.volume) && Number(c.volume) >= 0
  ).sort((a, b) => Number(a.time) - Number(b.time));
}

export function buildClosedFuturesVwap(candles, seconds, now, contract = {}) {
  const closed = completedFuturesCandles(candles, seconds, now);
  const unavailable = { available: false, source: 'UPSTOX', underlying: 'NIFTY',
    reason: 'Complete genuine session futures candles are unavailable' };
  if (!closed.length || !contract.instrument_key ||
      Number(closed[0].time) !== nseSessionBounds(now).open ||
      closed.some((c, i) => i > 0 && Number(c.time) !== Number(closed[i - 1].time) + Number(seconds))) {
    return unavailable;
  }
  let pv = 0, volume = 0;
  for (const c of closed) {
    pv += (Number(c.high) + Number(c.low) + Number(c.close)) / 3 * Number(c.volume);
    volume += Number(c.volume);
  }
  const latest = closed.at(-1);
  if (!(volume > 0) || !positive(latest.volume) || !positive(pv / volume)) return unavailable;
  return { available: true, closed: true, source: 'UPSTOX', underlying: 'NIFTY',
    instrumentKey: contract.instrument_key,
    contract: contract.trading_symbol || contract.tradingsymbol || contract.name,
    seconds: Number(seconds), lastCandleTime: Number(latest.time),
    futuresPrice: Number(latest.close), vwap: pv / volume, cumulativeVolume: volume,
    label: 'NIFTY futures closed-candle VWAP confirmation (not index VWAP)' };
}

export function resolveClosedVwap({ indexVwap, last, side, symbol, seconds, now,
  futures = null, replay = false }) {
  const unavailable = reason => ({ available: false, ok: false, reason, source: 'Unavailable' });
  if (positive(indexVwap)) {
    return { available: true, ok: (side === 1 || side === -1) &&
      positive(last?.close) && (Number(last.close) - Number(indexVwap)) * side > 0,
      source: 'Chart closed-candle VWAP', value: Number(indexVwap),
      price: Number(last?.close), reason: 'Chart closed-candle VWAP conflicts or direction is neutral' };
  }
  if (replay || symbol !== 'NIFTY') {
    return unavailable('Closed-candle VWAP unavailable; live futures are not used for Replay or another index');
  }
  const time = futures?.lastCandleTime;
  const end = Number(time) + Number(seconds);
  if (futures?.available !== true || futures.closed !== true || futures.source !== 'UPSTOX' ||
      futures.underlying !== 'NIFTY' || !futures.instrumentKey ||
      !supported(seconds) || Number(futures.seconds) !== Number(seconds) ||
      !positive(time) || Number(time) !== Number(last?.time) ||
      nseCandleBucket(time, seconds) !== Number(time) ||
      !positive(now) || !regularNseHours(Number(now) * 1000) ||
      end > Number(now) || now - end > Math.max(Number(seconds), 60) ||
      nseSessionBounds(time)?.open !== nseSessionBounds(now)?.open ||
      !positive(futures.futuresPrice) || !positive(futures.vwap) || !positive(futures.cumulativeVolume)) {
    return unavailable('Genuine completed NIFTY futures VWAP is missing, stale or not aligned with the chart candle');
  }
  // Compare futures with futures: never compare the index price with a futures
  // level, since the contract basis can differ from the spot index.
  return { available: true, ok: (side === 1 || side === -1) &&
    (Number(futures.futuresPrice) - Number(futures.vwap)) * side > 0,
    source: futures.label || 'NIFTY futures closed-candle VWAP confirmation (not index VWAP)',
    value: Number(futures.vwap), price: Number(futures.futuresPrice),
    time: Number(time), reason: 'Closed-candle futures VWAP conflicts or direction is neutral' };
}
