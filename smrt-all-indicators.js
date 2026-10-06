// smrt-all-indicators.js
// SMRT ALL INDICATORS CONSENSUS - NIFTY 50 PRIME
// Fail closed: WAIT / NO TRADE / NOT READY / unavailable states never vote.

const neutralState = value => {
  const text = String(value || '').trim().toUpperCase();
  if (!text) return true;
  return /^(NO TRADE|WAIT|WAITING|NOT READY|UNAVAILABLE|MIXED|CONFLICT|NEUTRAL|N\/A|NA)(\b|\s|·|:|-)/.test(text) ||
    /\b(NO TRADE|NOT READY|UNAVAILABLE)\b/.test(text);
};

const sideFromText = value => {
  const text = String(value || '').trim().toUpperCase();
  if (neutralState(text)) return 0;
  const up = /\b(BUY|BULLISH|LONG)\b/.test(text);
  const down = /\b(SELL|BEARISH|SHORT)\b/.test(text);
  return up === down ? 0 : up ? 1 : -1;
};

const actionableFinalizerSide = finalizer => {
  const state = String(finalizer?.state || '').trim().toUpperCase();
  if (state === 'BUY SETUP' || state === 'STRONG BUY SETUP') return 1;
  if (state === 'SELL SETUP' || state === 'STRONG SELL SETUP') return -1;
  return 0;
};

export function analyseAllIndicators({
  finalizer,
  edge,
  marketMap,
  mtf,
  gainz,
  aiNifty,
  globalWatch,
  technicalIndicators
} = {}) {
  const votes = [];
  const TOTAL_GROUPS = 11;
  const MIN_ACTIVE_GROUPS = 6;

  const pushVote = (name, side, weight, detail) => {
    if (side !== 1 && side !== -1) return;
    const safeWeight = Number(weight);
    if (!Number.isFinite(safeWeight) || safeWeight <= 0) return;
    votes.push({ name, side, weight: safeWeight, detail });
  };

  const finalizerSide = actionableFinalizerSide(finalizer);
  pushVote('Trade Finalizer', finalizerSide, 4, finalizer?.state);

  const edgeLatest = edge?.latest;
  const edgeSignal = String(edgeLatest?.signal || '').trim().toUpperCase();
  const edgeSide = ['BUY', 'BUY+', 'SELL', 'SELL+'].includes(edgeSignal)
    ? (Number(edgeLatest?.side) === 1 || Number(edgeLatest?.side) === -1
        ? Number(edgeLatest.side)
        : sideFromText(edgeSignal))
    : 0;
  pushVote('NIFTY EDGE', edgeSide, 3, edgeLatest?.signal);

  // An explicit Market Map action is authoritative. If it says NO TRADE / WAIT /
  // NOT READY, it must remain neutral and must NOT fall back to the trend label.
  const rawMapAction = marketMap?.action;
  const mapAction = String(rawMapAction || '').trim();
  const mapSide = mapAction
    ? sideFromText(mapAction)
    : sideFromText(marketMap?.trend);
  pushVote('Market Map', mapSide, 2, mapAction || marketMap?.trend);

  const mtfSide = sideFromText(mtf?.overall);
  pushVote('MTF 5m/15m/1h', mtfSide, 4, mtf?.overall);

  const gainzSignal = String(gainz?.latest?.signal || '').trim().toUpperCase();
  const gainzSide = gainzSignal.startsWith('LONG') || gainzSignal.startsWith('SHORT')
    ? (Number(gainz?.latest?.side) === 1 || Number(gainz?.latest?.side) === -1
        ? Number(gainz.latest.side)
        : sideFromText(gainzSignal))
    : 0;
  pushVote('SSL + QQE', gainzSide, 3, gainz?.latest?.signal);

  const aiSide = sideFromText(aiNifty?.signal);
  pushVote('AI NIFTY', aiSide, 2, aiNifty?.signal);

  const globalSide = sideFromText(globalWatch?.bias);
  pushVote('Global Watch', globalSide, 1, globalWatch?.bias);

  const technical = technicalIndicators && typeof technicalIndicators === 'object'
    ? technicalIndicators
    : {};

  const compositeSide = values => {
    let bullish = 0;
    let bearish = 0;
    for (const value of Array.isArray(values) ? values : []) {
      let side = 0;
      if (typeof value === 'number') {
        side = value === 1 || value === -1 ? value : 0;
      } else if (value && typeof value === 'object') {
        // Advanced indicators expose numeric side. Prefer it so WAIT side=0 can
        // never be reinterpreted from descriptive text.
        const numericSide = Number(value.side);
        if (numericSide === 1 || numericSide === -1) side = numericSide;
        else if (numericSide === 0 || neutralState(value.signal ?? value.state ?? value.bias ?? value.direction)) side = 0;
        else side = sideFromText(value.signal ?? value.state ?? value.bias ?? value.direction ?? '');
      } else {
        side = sideFromText(value);
      }
      if (side === 1) bullish++;
      if (side === -1) bearish++;
    }
    const active = bullish + bearish;
    return {
      side: active < 2 ? 0 : bullish > bearish ? 1 : bearish > bullish ? -1 : 0,
      bullish,
      bearish,
      active
    };
  };

  const trendComposite = compositeSide([
    technical.ichimoku,
    technical.specialK,
    technical.coppock
  ]);
  pushVote('Trend Composite', trendComposite.side, 3,
    `${trendComposite.bullish} bullish / ${trendComposite.bearish} bearish`);

  const momentumComposite = compositeSide([
    technical.rsi,
    technical.ppo,
    technical.rvi,
    technical.awesomeOscillator,
    technical.ultimateOscillator,
    technical.stochastic,
    technical.stochasticRsi,
    technical.connorsRsi
  ]);
  pushVote('Momentum Composite', momentumComposite.side, 3,
    `${momentumComposite.bullish} bullish / ${momentumComposite.bearish} bearish`);

  const reversalComposite = compositeSide([
    technical.tdSequential,
    technical.williamsR,
    technical.fisher,
    technical.ehlersFisher
  ]);
  pushVote('Reversal Composite', reversalComposite.side, 2,
    `${reversalComposite.bullish} bullish / ${reversalComposite.bearish} bearish`);

  const pressureComposite = compositeSide([
    technical.ibs,
    technical.qstick,
    technical.elderRay,
    technical.pvo,
    technical.chaikin
  ]);
  pushVote('Pressure / Volume Composite', pressureComposite.side, 2,
    `${pressureComposite.bullish} bullish / ${pressureComposite.bearish} bearish`);

  const bullWeight = votes.filter(v => v.side === 1).reduce((s, v) => s + v.weight, 0);
  const bearWeight = votes.filter(v => v.side === -1).reduce((s, v) => s + v.weight, 0);
  const totalWeight = bullWeight + bearWeight;
  const leader = bullWeight > bearWeight ? 1 : bearWeight > bullWeight ? -1 : 0;
  const leaderWeight = Math.max(bullWeight, bearWeight);
  const alignment = totalWeight > 0 ? leaderWeight / totalWeight * 100 : 0;
  const margin = Math.abs(bullWeight - bearWeight);
  const activeGroups = votes.length;
  const alignedCount = leader === 0 ? 0 : votes.filter(v => v.side === leader).length;
  const opposingCount = leader === 0 ? 0 : votes.filter(v => v.side === -leader).length;
  const participation = Math.min(100, activeGroups / TOTAL_GROUPS * 100);

  let confidence = totalWeight > 0
    ? Math.round(alignment * participation / 100)
    : 0;
  confidence = Math.max(0, Math.min(100, confidence));

  let gatePassed = true;
  let gateReason = null;
  if (finalizerSide !== 1 && finalizerSide !== -1) {
    gatePassed = false;
    gateReason = 'Trade Finalizer has not confirmed an actionable setup.';
  } else if (mtfSide !== 1 && mtfSide !== -1) {
    gatePassed = false;
    gateReason = '5m / 15m / 1h confirmation is not ready.';
  } else if (finalizerSide !== mtfSide) {
    gatePassed = false;
    gateReason = 'Trade Finalizer and MTF directions conflict.';
  }

  let signal = 'NO TRADE';
  if (gatePassed && activeGroups >= MIN_ACTIVE_GROUPS && leader === finalizerSide && alignment >= 80 && margin >= 6) {
    signal = leader === 1 ? 'STRONG BUY' : 'STRONG SELL';
  } else if (gatePassed && activeGroups >= MIN_ACTIVE_GROUPS && leader === finalizerSide && alignment >= 65 && margin >= 3) {
    signal = leader === 1 ? 'BUY' : 'SELL';
  }

  let side = signal.includes('BUY') ? 1 : signal.includes('SELL') ? -1 : 0;
  if (side !== 0 && (side !== finalizerSide || side !== mtfSide)) {
    signal = 'NO TRADE';
    side = 0;
    gatePassed = false;
    gateReason = 'Final display direction failed Prime confirmation.';
  }

  if (side !== 0 && gainzSide !== 0 && gainzSide !== side) {
    signal = 'NO TRADE';
    side = 0;
    gatePassed = false;
    gateReason = 'SSL + QQE conflicts with the proposed trade direction.';
  }

  if (signal === 'NO TRADE') confidence = Math.min(confidence, 64);

  let reason;
  if (gateReason) reason = gateReason;
  else if (activeGroups === 0) reason = 'Indicator confirmation is not ready.';
  else if (activeGroups < MIN_ACTIVE_GROUPS) {
    reason = `${activeGroups} of ${TOTAL_GROUPS} indicator groups are active. Waiting for broader confirmation.`;
  } else if (signal === 'NO TRADE') reason = 'Indicators do not meet the Prime confirmation threshold.';
  else reason = `${alignedCount} indicator groups align with the ${side === 1 ? 'bullish' : 'bearish'} Prime direction.`;

  return {
    signal,
    side,
    confidence,
    alignment: Math.round(alignment),
    participation: Math.round(participation),
    bullWeight,
    bearWeight,
    alignedCount,
    opposingCount,
    totalVotes: activeGroups,
    totalGroups: TOTAL_GROUPS,
    minimumActiveGroups: MIN_ACTIVE_GROUPS,
    margin,
    votes,
    gatePassed,
    gateReason,
    finalizerSide,
    mtfSide,
    gainzSide,
    reason
  };
}
