// smrt-ai-nifty.js
// ============================================================
// SMRT AI NIFTY 50
// Multi-source deterministic decision-support engine.
// Combines Upstox app state with independent external sources.
// External/MTF inputs may confirm or veto, but never create direction.
// Untimestamped or stale external sources are neutral and cannot vote.
// No automatic order placement and no guaranteed accuracy.
// ============================================================

const finite = value =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isFinite(Number(value));

const timestampMs = value => {
  if (value === null || value === undefined || value === '') return null;
  if (finite(value)) {
    const n = Number(value);
    return n < 1e12 ? n * 1000 : n;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const sourceTimestamp = source =>
  timestampMs(
    source?.timestamp ??
    source?.time ??
    source?.updated ??
    source?.updatedAt
  );

const sourceFresh = (source, now, maxAgeMs) => {
  if (!source || source.live !== true) return false;
  const ts = sourceTimestamp(source);
  if (ts === null) return false;
  const age = Math.max(0, now - ts);
  return age <= maxAgeMs;
};

const sourceSide = source => {
  if (!source) return 0;

  if (source.name === 'TradingView') {
    const rec = Number(source.recommendAll);

    if (finite(rec)) {
      if (rec >= 0.2) return 1;
      if (rec <= -0.2) return -1;
    }

    const ema20 = Number(source.ema20);
    const ema50 = Number(source.ema50);

    if (finite(ema20) && finite(ema50)) {
      if (ema20 > ema50) return 1;
      if (ema20 < ema50) return -1;
    }

    return 0;
  }

  if (source.name === 'Moneycontrol' || source.name === 'Trendlyne') {
    const rating = String(source.technicalRating || '').toUpperCase();

    if (rating.includes('BULLISH')) return 1;
    if (rating.includes('BEARISH')) return -1;
    return 0;
  }

  const change = Number(source.changePercent);
  const momentum = Number(source.momentum);

  const combined =
    (finite(change) ? change : 0) +
    (finite(momentum) ? momentum : 0);

  if (combined > 0.08) return 1;
  if (combined < -0.08) return -1;
  return 0;
};

export function analyseSmrtAiNifty({
  upstoxPrice,
  finalizer,
  mtf,
  external,
  now = Date.now(),
  externalMaxAgeMs = 20 * 60 * 1000
} = {}) {

  const reasons = [];
  let score = 0;

  const safeNow = finite(now) ? Number(now) : Date.now();
  const maxAgeMs = finite(externalMaxAgeMs)
    ? Math.max(60000, Number(externalMaxAgeMs))
    : 20 * 60 * 1000;

  const finalizerState = String(finalizer?.state || 'NO TRADE').toUpperCase();
  const finalizerBuy = /\bBUY\b/.test(finalizerState) || finalizerState.includes('BUY+');
  const finalizerSell = /\bSELL\b/.test(finalizerState) || finalizerState.includes('SELL+');
  const finalizerSide = finalizerBuy === finalizerSell ? 0 : finalizerBuy ? 1 : -1;

  if (finalizerSide === 1) {
    score += finalizerState.includes('STRONG') ? 35 : 28;
    reasons.push('SMRT Finalizer bullish');
  } else if (finalizerSide === -1) {
    score -= finalizerState.includes('STRONG') ? 35 : 28;
    reasons.push('SMRT Finalizer bearish');
  } else {
    reasons.push('SMRT Finalizer has no actionable direction');
  }

  const mtfRows = [mtf?.['5m'], mtf?.['15m'], mtf?.['1h']];
  let mtfBull = 0;
  let mtfBear = 0;

  for (const row of mtfRows) {
    if (row?.side === 1) {
      mtfBull += 1;
      score += 10;
    }
    if (row?.side === -1) {
      mtfBear += 1;
      score -= 10;
    }
  }

  if (mtfBull === 3) reasons.push('5m / 15m / 1h bullish');
  else if (mtfBear === 3) reasons.push('5m / 15m / 1h bearish');
  else if (mtfBull || mtfBear) reasons.push('MTF mixed ' + mtfBull + ' bull / ' + mtfBear + ' bear');

  const sources = Array.isArray(external?.sources) ? external.sources : [];
  let externalBull = 0;
  let externalBear = 0;
  let externalNeutral = 0;
  let freshSourceCount = 0;
  let staleSourceCount = 0;

  const eligibleSources = [];

  for (const source of sources) {
    const fresh = sourceFresh(source, safeNow, maxAgeMs);

    if (!fresh) {
      externalNeutral += 1;
      staleSourceCount += 1;
      reasons.push(String(source?.name || 'External source') + ' stale/untimestamped — neutral');
      continue;
    }

    freshSourceCount += 1;
    eligibleSources.push(source);
    const side = sourceSide(source);

    if (side === 1) {
      externalBull += 1;
      score += source.name === 'TradingView' ? 15 : 12;
      reasons.push(source.name + ' bullish');
    } else if (side === -1) {
      externalBear += 1;
      score -= source.name === 'TradingView' ? 15 : 12;
      reasons.push(source.name + ' bearish');
    } else {
      externalNeutral += 1;
    }
  }

  const upstox = Number(upstoxPrice);
  const externalPrices = eligibleSources
    .map(source => Number(source.price))
    .filter(finite);

  let priceAgreement = null;

  if (finite(upstox) && externalPrices.length) {
    const average = externalPrices.reduce((total, value) => total + value, 0) / externalPrices.length;
    priceAgreement = Math.abs(average - upstox) / upstox * 100;
    if (priceAgreement <= 0.15) reasons.push('Fresh external prices agree with Upstox');
  }

  const absScore = Math.min(100, Math.round(Math.abs(score)));
  const directionalSources = externalBull + externalBear;
  let signal = 'NO TRADE';

  // Finalizer is the mandatory direction source. MTF and fresh external feeds
  // are confirmation/veto layers only; they cannot manufacture BUY/SELL.
  if (
    finalizerSide === 1 &&
    score >= 45 &&
    (externalBull >= 1 || mtfBull >= 2) &&
    mtfBear === 0 &&
    externalBear === 0
  ) {
    signal = 'BUY';
  } else if (
    finalizerSide === -1 &&
    score <= -45 &&
    (externalBear >= 1 || mtfBear >= 2) &&
    mtfBull === 0 &&
    externalBull === 0
  ) {
    signal = 'SELL';
  }

  if (externalBull > 0 && externalBear > 0) {
    signal = 'NO TRADE';
    reasons.push('Fresh external sources disagree');
  }

  if (finalizerSide === 1 && (mtfBear > 0 || externalBear > 0)) {
    signal = 'NO TRADE';
    reasons.push('Bullish Finalizer blocked by bearish confirmation conflict');
  }

  if (finalizerSide === -1 && (mtfBull > 0 || externalBull > 0)) {
    signal = 'NO TRADE';
    reasons.push('Bearish Finalizer blocked by bullish confirmation conflict');
  }

  const plan = signal !== 'NO TRADE' && finalizerSide !== 0 && finalizer?.plan
    ? finalizer.plan
    : null;

  return {
    signal,
    confidence: signal === 'NO TRADE' ? Math.min(absScore, 64) : absScore,
    rawScore: score,
    externalBull,
    externalBear,
    externalNeutral,
    directionalSources,
    sourceCount: sources.length,
    freshSourceCount,
    staleSourceCount,
    externalMaxAgeMs: maxAgeMs,
    priceAgreement,
    reasons: reasons.slice(0, 8),
    plan,
    updated: safeNow
  };
}
