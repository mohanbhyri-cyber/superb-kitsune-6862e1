// smrt-market-map.js
// ============================================================
// SMRT MARKET MAP
// Original NIFTY 50 support/resistance, trend, breakout and
// reversal analysis using closed candles only.
// ============================================================

import { indicators } from './market.js';
import { trendIndicators } from './trend-indicators.js';

const finite = v =>
  v !== null &&
  v !== undefined &&
  v !== '' &&
  Number.isFinite(Number(v));

function atrSeries(candles, period = 14) {
  const out = Array(candles.length).fill(null);
  let seed = 0;
  let atr = null;

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];

    const tr = Math.max(
      Number(c.high) - Number(c.low),
      Math.abs(Number(c.high) - Number(p.close)),
      Math.abs(Number(c.low) - Number(p.close))
    );

    if (i <= period) seed += tr;

    if (i === period) {
      atr = seed / period;
    } else if (i > period && atr !== null) {
      atr = (atr * (period - 1) + tr) / period;
    }

    out[i] = atr;
  }

  return out;
}

function pivots(candles, left = 3, right = 3) {
  const highs = [];
  const lows = [];

  for (let i = left; i < candles.length - right; i++) {
    const h = Number(candles[i].high);
    const l = Number(candles[i].low);

    let isHigh = true;
    let isLow = true;

    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (Number(candles[j].high) >= h) isHigh = false;
      if (Number(candles[j].low) <= l) isLow = false;
    }

    if (isHigh) highs.push({ index: i, price: h, time: candles[i].time });
    if (isLow) lows.push({ index: i, price: l, time: candles[i].time });
  }

  return { highs, lows };
}

function clusterLevels(points, tolerance) {
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const zones = [];

  for (const point of sorted) {
    const existing = zones.find(z => Math.abs(z.price - point.price) <= tolerance);

    if (existing) {
      existing.touches += 1;
      existing.price =
        (existing.price * (existing.touches - 1) + point.price) /
        existing.touches;
      existing.lastTime = Math.max(existing.lastTime, point.time);
    } else {
      zones.push({
        price: point.price,
        touches: 1,
        lastTime: point.time
      });
    }
  }

  return zones;
}

function trendLabel(score, adx) {
  if (score >= 4 && adx >= 25) return 'STRONG BULLISH';
  if (score >= 2) return 'BULLISH';
  if (score <= -4 && adx >= 25) return 'STRONG BEARISH';
  if (score <= -2) return 'BEARISH';
  return 'RANGE / MIXED';
}

export function analyseMarketMap(candles, options = {}) {
  if (!Array.isArray(candles) || candles.length < 40) {
    return null;
  }

  const closedIndex = Math.max(0, candles.length - 2);
  const calc = indicators(candles);
  const trend = trendIndicators(candles);
  const atr14 = atrSeries(candles, 14);
  const atr = Number(atr14[closedIndex]);

  if (!finite(atr) || atr <= 0) return null;

  const { highs, lows } = pivots(candles, 3, 3);
  const tolerance = atr * 0.45;

  const resistanceZones = clusterLevels(
    highs.filter(p => p.index <= closedIndex).slice(-18),
    tolerance
  );

  const supportZones = clusterLevels(
    lows.filter(p => p.index <= closedIndex).slice(-18),
    tolerance
  );

  const close = Number(candles[closedIndex].close);
  const prevClose = Number(candles[closedIndex - 1]?.close);
  const e9 = Number(calc.e9?.[closedIndex]);
  const e21 = Number(calc.e21?.[closedIndex]);
  const e50 = Number(calc.e50?.[closedIndex]);
  const rsi = Number(calc.rsi?.[closedIndex]);
  const hist = Number(calc.hist?.[closedIndex]);
  const prevHist = Number(calc.hist?.[closedIndex - 1]);
  const stDir = Number(trend.direction?.[closedIndex] || 0);
  const adx = Number(trend.adx?.[closedIndex]);
  const plusDI = Number(trend.plusDI?.[closedIndex]);
  const minusDI = Number(trend.minusDI?.[closedIndex]);

  const indexVWAP = Number(calc.vwap?.[closedIndex]);
  const futuresVWAP = finite(options.futuresVWAP)
    ? Number(options.futuresVWAP)
    : null;
  const vwap = finite(indexVWAP) ? indexVWAP : futuresVWAP;

  const nearestSupport = supportZones
    .filter(z => z.price <= close + tolerance)
    .sort((a, b) => b.price - a.price)[0] || null;

  const nearestResistance = resistanceZones
    .filter(z => z.price >= close - tolerance)
    .sort((a, b) => a.price - b.price)[0] || null;

  let score = 0;

  if (e9 > e21) score += 1;
  else if (e9 < e21) score -= 1;

  if (e21 > e50) score += 1;
  else if (e21 < e50) score -= 1;

  if (stDir === 1) score += 1;
  else if (stDir === -1) score -= 1;

  if (plusDI > minusDI) score += 1;
  else if (minusDI > plusDI) score -= 1;

  if (finite(vwap)) {
    if (close > vwap) score += 1;
    else if (close < vwap) score -= 1;
  }

  const trendState = trendLabel(score, finite(adx) ? adx : 0);

  let breakout = 'NONE';

  if (
    nearestResistance &&
    prevClose <= nearestResistance.price + tolerance * 0.25 &&
    close > nearestResistance.price + atr * 0.15
  ) {
    breakout = 'BREAKOUT UP';
  }

  if (
    nearestSupport &&
    prevClose >= nearestSupport.price - tolerance * 0.25 &&
    close < nearestSupport.price - atr * 0.15
  ) {
    breakout = 'BREAKDOWN';
  }

  const nearSupport =
    nearestSupport &&
    Math.abs(close - nearestSupport.price) <= atr * 0.65;

  const nearResistance =
    nearestResistance &&
    Math.abs(close - nearestResistance.price) <= atr * 0.65;

  const bullishMomentumTurn =
    finite(rsi) &&
    finite(hist) &&
    finite(prevHist) &&
    rsi >= 42 &&
    rsi <= 58 &&
    hist > prevHist;

  const bearishMomentumTurn =
    finite(rsi) &&
    finite(hist) &&
    finite(prevHist) &&
    rsi >= 42 &&
    rsi <= 62 &&
    hist < prevHist;

  let reversal = 'NONE';

  if (
    nearSupport &&
    bullishMomentumTurn &&
    close > Number(candles[closedIndex].open) &&
    score >= -1
  ) {
    reversal = 'BULLISH REVERSAL';
  }

  if (
    nearResistance &&
    bearishMomentumTurn &&
    close < Number(candles[closedIndex].open) &&
    score <= 1
  ) {
    reversal = 'BEARISH REVERSAL';
  }

  let confluence = 0;
  if (Math.abs(score) >= 3) confluence += 2;
  else if (Math.abs(score) >= 2) confluence += 1;
  if (finite(adx) && adx >= 22) confluence += 2;
  if (breakout !== 'NONE') confluence += 2;
  if (reversal !== 'NONE') confluence += 2;
  if (nearestSupport || nearestResistance) confluence += 1;
  if (finite(vwap)) confluence += 1;

  confluence = Math.min(10, confluence);

  let action = 'NO TRADE';

  if (
    breakout === 'BREAKOUT UP' &&
    score >= 2 &&
    adx >= 22
  ) {
    action = 'BUY BREAKOUT';
  } else if (
    breakout === 'BREAKDOWN' &&
    score <= -2 &&
    adx >= 22
  ) {
    action = 'SELL BREAKDOWN';
  } else if (
    reversal === 'BULLISH REVERSAL' &&
    confluence >= 6
  ) {
    action = 'BUY REVERSAL';
  } else if (
    reversal === 'BEARISH REVERSAL' &&
    confluence >= 6
  ) {
    action = 'SELL REVERSAL';
  }

  return {
    time: candles[closedIndex].time,
    close,
    atr,
    nearestSupport,
    nearestResistance,
    supports: supportZones
      .filter(z => z.price < close)
      .sort((a, b) => b.price - a.price)
      .slice(0, 3),
    resistances: resistanceZones
      .filter(z => z.price > close)
      .sort((a, b) => a.price - b.price)
      .slice(0, 3),
    trend: trendState,
    trendScore: score,
    adx,
    reversal,
    breakout,
    action,
    confluence,
    vwap
  };
}
