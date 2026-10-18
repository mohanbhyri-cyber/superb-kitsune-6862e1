import { nseCandleBucket, nseSessionBounds } from './nse-candle-time.js?v=2';

// Local clock checks are cheap; broker history requests are not. Reconcile
// once just after each NSE-anchored close, with at most one delayed retry.
// No timer or fetch lives here, and callers must still enforce visibility,
// replay, session eligibility, in-flight guards and provider Retry-After.
export function createCandleRefreshSchedule() {
  const graceMs = 2000;
  const retryMs = 15000;
  let current = null;

  function windowFor(key, seconds, nowMs) {
    if (!key || !Number.isFinite(nowMs)) return null;
    const bucket = nseCandleBucket(nowMs / 1000, seconds);
    if (bucket === null) return null;
    return { key, seconds, bucket, target: bucket - Number(seconds),
      open: nseSessionBounds(nowMs / 1000).open };
  }

  function record(window) {
    return { ...window, attempts: 0, completed: false, pending: null,
      nextAttemptAt: window.bucket * 1000 + graceMs };
  }

  return {
    reset() { current = null; },

    markLoaded(key, seconds, nowMs, confirmedStart) {
      const window = windowFor(key, seconds, nowMs);
      current = window ? record(window) : null;
      if (current) {
        current.completed = confirmedStart !== null && confirmedStart !== undefined &&
          Number(confirmedStart) === current.target;
      }
    },

    take(key, seconds, nowMs) {
      const window = windowFor(key, seconds, nowMs);
      // The opening bucket has no completed candle in this session yet.
      if (!window || window.bucket === window.open) return null;
      if (!current || current.key !== key || current.seconds !== seconds ||
          current.bucket !== window.bucket) current = record(window);
      if (current.completed || current.pending || current.attempts >= 2 ||
          nowMs < current.nextAttemptAt) return null;
      const job = { record: current, target: current.target };
      current.attempts++;
      current.pending = job;
      return job;
    },

    finish(job, confirmed, nowMs) {
      // An old load, symbol or timeframe must not complete a newer schedule.
      if (!job || current !== job.record || current.pending !== job) return;
      current.pending = null;
      if (confirmed === true) current.completed = true;
      else {
        // A skipped request consumes no broker budget. Errors/late history
        // wait for a bounded retry as well as the caller's provider cooldown.
        if (confirmed === null) current.attempts--;
        current.nextAttemptAt = nowMs + (confirmed === null ? 1000 : retryMs);
      }
    }
  };
}
