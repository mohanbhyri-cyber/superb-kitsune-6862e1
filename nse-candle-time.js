import { regularNseHours } from './options-context.js';

const IST_OFFSET = 19800;
const DAY = 86400;

// Clock bounds only: provider history remains authoritative for exceptional
// exchange sessions. Live eligibility separately uses regularNseHours().
export function nseSessionBounds(time) {
  if (time === null || time === undefined || time === '' ||
      !Number.isFinite(Number(time)) || Number(time) <= 0) return null;
  const midnight = Math.floor((Number(time) + IST_OFFSET) / DAY) * DAY - IST_OFFSET;
  return { open: midnight + 555 * 60, close: midnight + 930 * 60 };
}

export function isNseIntradayTime(time) {
  const session = nseSessionBounds(time);
  return !!session && Number(time) >= session.open && Number(time) < session.close;
}

export function nseCandleBucket(time, seconds) {
  if (!isNseIntradayTime(time) || !Number.isFinite(Number(seconds)) ||
      Number(seconds) <= 0 || Number(seconds) >= DAY) return null;
  const { open } = nseSessionBounds(time);
  return open + Math.floor((Number(time) - open) / Number(seconds)) * Number(seconds);
}

function epochSeconds(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  const time = Number.isFinite(numeric)
    ? (numeric >= 1e12 ? numeric / 1000 : numeric)
    : Date.parse(String(value)) / 1000;
  return Number.isFinite(time) && time > 0 ? Math.floor(time) : null;
}

// Never turn the Worker's fetch time into an exchange trade timestamp.
// Index quotes can lack last_trade_time; a provider-stamped snapshot is
// explicitly labelled as such and may update a forming candle in-session only.
export function quoteCandleTime(quote) {
  const trade = epochSeconds(quote?.last_trade_time);
  if (trade !== null) return { time: trade, timeSource: 'LAST_TRADE' };
  const snapshot = epochSeconds(quote?.timestamp);
  return { time: snapshot, timeSource: snapshot === null ? 'UNAVAILABLE' : 'QUOTE_SNAPSHOT' };
}

export function liveCandleBucket(tick, seconds, now = Date.now() / 1000) {
  if (!regularNseHours(Number(now) * 1000) || tick?.candleEligible === false ||
      !isNseIntradayTime(tick?.time)) return null;
  const time = Number(tick.time);
  // Cached/late packets can update the quote display, never a completed bar.
  if (time > now + 5 || now - time > 30 ||
      nseSessionBounds(time).open !== nseSessionBounds(now)?.open) return null;
  return nseCandleBucket(time, seconds);
}

// Diagnostic only. liveCandleBucket remains the authority for eligibility;
// these messages never relax its session or timestamp checks.
export function liveCandleRejectionReason(tick, seconds, now = Date.now() / 1000) {
  if (!regularNseHours(Number(now) * 1000)) return 'NSE regular session is closed';
  if (tick?.time === null || tick?.time === undefined || tick?.time === '' ||
      !Number.isFinite(Number(tick.time)) || Number(tick.time) <= 0) {
    return 'Quote has no valid provider timestamp; price display only';
  }
  const time = Number(tick.time);
  if (!isNseIntradayTime(time)) {
    return 'Quote timestamp is outside NSE regular hours; price display only';
  }
  if (tick?.candleEligible === false) {
    return 'Provider quote is not eligible for candle updates; price display only';
  }
  if (nseSessionBounds(time).open !== nseSessionBounds(now)?.open) {
    return 'Quote belongs to a different NSE session; price display only';
  }
  if (time > Number(now) + 5) {
    return 'Quote timestamp is ' + Math.ceil(time - Number(now)) +
      's ahead of device time (maximum 5s); price display only';
  }
  if (Number(now) - time > 30) {
    return 'Quote timestamp is ' + Math.ceil(Number(now) - time) +
      's old (maximum 30s); price display only';
  }
  if (nseCandleBucket(time, seconds) === null) {
    return 'Candle interval is invalid; price display only';
  }
  return '';
}
