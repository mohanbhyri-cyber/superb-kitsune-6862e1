import { regularNseHours } from './options-context.js';

// The additional trigger must never override the final trade authority.
export function confirmedTrigger({ finalizer, consensus, now = Date.now(), seconds,
  replay = false, sample = false } = {}) {
  const wait = reason => ({ signal: 'WAIT', side: 0, score: 0, reason });
  if (replay || sample) return wait('Historical/sample analysis · no live trigger');
  if (!regularNseHours(now)) return wait('Market closed · no live trigger');
  const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  if (!finite(finalizer?.time) || !finite(seconds) || Number(seconds) <= 0)
    return wait('Closed-candle timestamp unavailable');
  const age = now / 1000 - Number(finalizer.time);
  if (age < Number(seconds) || age > Number(seconds) * 2 + 30)
    return wait('Closed candle forming or stale');
  const side = finalizer?.side;
  const signal = String(consensus?.signal || '').toUpperCase();
  const confirmedSide = /^(STRONG )?BUY\+?$/.test(signal) ? 1 : /^(STRONG )?SELL\+?$/.test(signal) ? -1 : 0;
  if (![1, -1].includes(side) || finalizer?.primeConfirmed !== true || confirmedSide !== side ||
      !finite(consensus?.confidence) || Number(consensus.confidence) < 80)
    return wait(finalizer?.invalidation || 'Finalizer and consensus confirmation incomplete');
  return { signal: side === 1 ? 'BUY' : 'SELL', side,
    score: Math.min(100, Number(consensus.confidence)),
    reason: 'Confirmed closed candle · Finalizer + consensus · confluence score, not win probability' };
}
