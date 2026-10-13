import { analyseRisk } from './smrt-risk-engine.js?v=2';

const positive = value => (typeof value === 'number' ||
  (typeof value === 'string' && value.trim() !== '')) &&
  Number.isFinite(Number(value)) && Number(value) > 0;
const direction = value => {
  const text = String(value || '').toUpperCase();
  if (/NO TRADE|WAIT|MIXED|CONFLICT|NEUTRAL|UNAVAILABLE/.test(text)) return 0;
  const buy = /\bBUY\b/.test(text), sell = /\bSELL\b/.test(text);
  return buy === sell ? 0 : buy ? 1 : -1;
};
const reasonText = (reasons, fallback) => Array.isArray(reasons) && reasons.length
  ? reasons.slice(0, 2).join(' · ') : fallback;

// Display-only: never creates a plan, alters a gate, or changes trading state.
export function riskMapDisplay({ finalizer, prime, consensus, risk,
  closedTime, atr, sessionOpen = false, replay = false } = {}) {
  const waiting = (status, reason, tone = 'muted') => ({
    status, reason, tone, plan: null, analysis: null
  });
  if (!replay && sessionOpen !== true) return waiting('MARKET CLOSED',
    'NSE session closed · no active live trade plan.');
  if (!positive(closedTime) || !positive(prime?.time)) return waiting('WAIT · DATA UNAVAILABLE',
    'Waiting for completed-candle analysis.');
  const checks = Array.isArray(prime.checks) ? prime.checks : [];
  const freshness = checks.find(check => check?.name === 'Closed-candle freshness');
  if (freshness?.ok !== true) return waiting('WAIT · STALE / UNAVAILABLE DATA',
    reasonText(prime.reasons, 'Completed-candle freshness is not confirmed.'));
  if (Number(prime.time) !== Number(closedTime) ||
      (finalizer?.plan && (!positive(finalizer.time) || Number(finalizer.time) !== Number(closedTime)))) {
    return waiting('WAIT · CANDLE MISMATCH', 'Risk plan and analysis must match the latest completed candle.');
  }
  if (!finalizer?.plan) {
    if (risk?.ready === true && risk.quality === 'BLOCK') return waiting('RISK BLOCKED',
      reasonText(risk.reasons, risk.state || 'Risk checks rejected the setup.'), 'down');
    return waiting('WAIT · CONFIRMATION INCOMPLETE', reasonText(finalizer?.reasons,
      'No confirmed BUY/SELL plan · entry, stop and targets are withheld.'));
  }
  const side = direction(finalizer.state);
  const aligned = side !== 0 && finalizer.side === side && finalizer.primeConfirmed === true &&
    prime.side === side && direction(consensus?.signal) === side &&
    !checks.some(check => !check || (check.required !== false && check.ok !== true));
  if (!aligned) return waiting('WAIT · CONFIRMATION INCOMPLETE', reasonText(finalizer.reasons,
    'Finalizer, Prime and Consensus must agree before trade levels are displayed.'));
  if (risk?.ready === true && risk.quality === 'BLOCK') return waiting('RISK BLOCKED',
    reasonText(risk.reasons, risk.state || 'Risk checks rejected the setup.'), 'down');
  const analysis = analyseRisk(finalizer.plan, { side, atr, contextFresh: true });
  if (analysis.quality === 'BLOCK') return waiting('RISK BLOCKED',
    reasonText(analysis.reasons, analysis.state), 'down');
  return {
    status: (replay ? 'REPLAY · ' : '') + analysis.state + ' · ' + analysis.score + '/100',
    reason: (replay ? 'Historical sample · not a live trade. ' : '') +
      'Confirmed ' + (side === 1 ? 'BUY' : 'SELL') + ' plan · ' +
      reasonText(analysis.reasons, 'stop and targets passed risk validation.'),
    tone: analysis.quality === 'GOOD' ? 'up' : 'muted',
    plan: finalizer.plan, analysis
  };
}
