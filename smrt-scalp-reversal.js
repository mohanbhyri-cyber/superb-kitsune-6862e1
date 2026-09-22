// smrt-scalp-reversal.js
// ============================================================
// SMRT SCALP REVERSAL PRO
// Original NIFTY 50 scalp/reversal indicator inspired by the
// requested visual style. Closed-candle confirmation only.
// ============================================================

const finite = v => Number.isFinite(Number(v));

export function scalpReversalSignal({
  edge,
  marketMap,
  candleSetup,
  finalizer,
  mtf
}) {
  const edgeNow = edge?.latest;
  const map = marketMap;
  const fin = finalizer;
  const candle = candleSetup;

  if (!edgeNow || !map || !fin) {
    return {
      signal: 'NO TRADE',
      side: 0,
      strength: 0,
      plan: null,
      reason: 'Waiting for confirmed closed-candle confluence'
    };
  }

  let longScore = 0;
  let shortScore = 0;
  const reasons = [];

  if (['BUY+','BUY'].includes(edgeNow.signal)) {
    longScore += edgeNow.signal === 'BUY+' ? 3 : 2;
    reasons.push('NIFTY EDGE bullish');
  }

  if (['SELL+','SELL'].includes(edgeNow.signal)) {
    shortScore += edgeNow.signal === 'SELL+' ? 3 : 2;
    reasons.push('NIFTY EDGE bearish');
  }

  if (map.trend?.includes('BULLISH')) {
    longScore += 2;
    reasons.push('Market trend bullish');
  }

  if (map.trend?.includes('BEARISH')) {
    shortScore += 2;
    reasons.push('Market trend bearish');
  }

  if (map.reversal === 'BULLISH REVERSAL') {
    longScore += 2;
    reasons.push('Bullish reversal');
  }

  if (map.reversal === 'BEARISH REVERSAL') {
    shortScore += 2;
    reasons.push('Bearish reversal');
  }

  if (map.breakout === 'BREAKOUT UP') {
    longScore += 2;
    reasons.push('Breakout confirmed');
  }

  if (map.breakout === 'BREAKDOWN') {
    shortScore += 2;
    reasons.push('Breakdown confirmed');
  }

  if (candle?.action?.startsWith('BUY')) {
    longScore += 2;
    reasons.push('Bullish candle confluence');
  }

  if (candle?.action?.startsWith('SELL')) {
    shortScore += 2;
    reasons.push('Bearish candle confluence');
  }

  if (mtf?.overall?.includes('BUY')) {
    longScore += 3;
    reasons.push('MTF bullish');
  }

  if (mtf?.overall?.includes('SELL')) {
    shortScore += 3;
    reasons.push('MTF bearish');
  }

  if (fin.state?.includes('BUY')) {
    longScore += fin.state.startsWith('STRONG') ? 4 : 3;
    reasons.push('Trade Finalizer bullish');
  }

  if (fin.state?.includes('SELL')) {
    shortScore += fin.state.startsWith('STRONG') ? 4 : 3;
    reasons.push('Trade Finalizer bearish');
  }

  const side = longScore > shortScore ? 1 : shortScore > longScore ? -1 : 0;
  const strength = Math.max(longScore, shortScore);
  const gap = Math.abs(longScore - shortScore);

  let signal = 'NO TRADE';

  if (side === 1 && strength >= 10 && gap >= 4) {
    signal = strength >= 13 ? 'LONG+' : 'LONG';
  } else if (side === -1 && strength >= 10 && gap >= 4) {
    signal = strength >= 13 ? 'SHORT+' : 'SHORT';
  }

  const plan = signal !== 'NO TRADE'
    ? fin.plan || edgeNow.plan || null
    : null;

  return {
    signal,
    side: signal.startsWith('LONG') ? 1 : signal.startsWith('SHORT') ? -1 : 0,
    strength,
    longScore,
    shortScore,
    plan,
    reason: reasons.slice(0, 6).join(' · ')
  };
}
