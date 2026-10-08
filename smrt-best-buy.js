import { analyseRisk } from './smrt-risk-engine.js';

const finite = value => value !== null && value !== undefined &&
  value !== '' && Number.isFinite(Number(value));
const positive = value => finite(value) && Number(value) > 0;
const bullish = value => /^(BUY\+?|CALL|LONG|BULLISH|STRONG BUY)$/.test(
  String(value || '').trim().toUpperCase()
);

// A buy-only view of the existing confirmed setup. It never creates a plan.
export function analyseBestBuySetup({
  candles, seconds, now, finalizer, prime, consensus, atr,
  sessionOpen = false, replay = false, sample = false
} = {}) {
  const checks = [];
  const check = (name, ok) => checks.push({ name, ok: ok === true });
  const result = (signal, reasons, plan = null, rr1 = null) => ({
    signal, side: signal === 'BUY' ? 1 : 0, plan, rr1,
    time: candle?.time ?? null, checks,
    reasons: reasons.filter(Boolean).slice(0, 4),
    mode: replay ? 'REPLAY' : sample ? 'DEMO' : 'LIVE'
  });
  const clockReady = positive(seconds) && positive(now);
  const candle = clockReady && Array.isArray(candles)
    ? candles.findLast(row => positive(row?.time) &&
        Number(row.time) + Number(seconds) <= Number(now))
    : null;
  const validCandle = candle &&
    ['open', 'high', 'low', 'close'].every(key => positive(candle[key])) &&
    Number(candle.high) >= Math.max(Number(candle.open), Number(candle.close)) &&
    Number(candle.low) <= Math.min(Number(candle.open), Number(candle.close));
  check('Closed-candle data', Boolean(validCandle));
  if (!validCandle || sample) {
    return result('WAIT', [sample
      ? 'Demo data cannot confirm a live Best Buy setup.'
      : 'Waiting for a valid completed candle.']);
  }

  const age = Number(now) - (Number(candle.time) + Number(seconds));
  check('Candle freshness', age <= Math.max(Number(seconds) * 3, 900));
  check('Session open', replay || sessionOpen);
  check('Same candle in Finalizer and Prime',
    positive(finalizer?.time) && positive(prime?.time) &&
    Number(finalizer.time) === Number(candle.time) &&
    Number(prime.time) === Number(candle.time));
  if (checks.some(item => !item.ok)) {
    return result('WAIT', checks.filter(item => !item.ok).map(item =>
      item.name + ' is unavailable, stale, or incomplete.'));
  }

  check('Bullish Finalizer', Number(finalizer?.side) === 1 &&
    bullish(finalizer?.state) && finalizer?.primeConfirmed === true);
  check('Bullish Prime confirmation', Number(prime?.side) === 1 &&
    bullish(prime?.signal));
  const required = Array.isArray(prime?.checks)
    ? prime.checks.filter(item => item?.required !== false)
    : [];
  check('All mandatory Prime checks', required.length > 0 &&
    required.every(item => item.ok === true));
  check('Bullish consensus at least 80/100',
    bullish(consensus?.signal) && consensus?.primeConfirmed === true &&
    finite(consensus?.confidence) && Number(consensus.confidence) >= 80 &&
    !(Number(consensus.opposingCount) > 0) &&
    !consensus.votes?.some(vote => Number(vote.side) === -1));
  if (checks.some(item => !item.ok)) {
    const bearish = Number(finalizer?.side) === -1 || Number(prime?.side) === -1;
    return result(bearish ? 'NO TRADE' : 'WAIT', [
      bearish ? 'Current confirmed direction is bearish; no buy setup.' : null,
      ...(Array.isArray(prime?.reasons) ? prime.reasons : []),
      ...(Array.isArray(finalizer?.reasons) ? finalizer.reasons : []),
      ...checks.filter(item => !item.ok).map(item => item.name + ' is incomplete.')
    ]);
  }

  const source = finalizer.plan;
  const stop = source?.stopLoss ?? source?.stop;
  const validPlan = source && positive(stop) &&
    ['entry', 'target1', 'target2', 'target3'].every(key => positive(source[key])) &&
    Number(stop) < Number(source.entry) &&
    Number(source.entry) < Number(source.target1) &&
    Number(source.target1) < Number(source.target2) &&
    Number(source.target2) < Number(source.target3);
  check('Entry, stop and ordered targets', Boolean(validPlan));
  if (!validPlan) return result('NO TRADE', ['Buy trade plan is invalid or incomplete.']);

  const plan = {
    entry: Number(source.entry), stop: Number(stop),
    target1: Number(source.target1), target2: Number(source.target2),
    target3: Number(source.target3)
  };
  const risk = analyseRisk(plan, { side: 1, atr, contextFresh: true });
  check('Risk acceptable', risk.ready === true && risk.quality === 'GOOD');
  check('Target 1 reward / risk at least 1.5', finite(risk.rr1) && risk.rr1 >= 1.5);
  if (checks.some(item => !item.ok)) {
    return result('NO TRADE', [
      ...(risk.reasons || []),
      ...checks.filter(item => !item.ok).map(item => item.name + ' failed.')
    ]);
  }
  return result('BUY', ['Bullish closed-candle confirmation and risk checks passed.'], plan, risk.rr1);
}
