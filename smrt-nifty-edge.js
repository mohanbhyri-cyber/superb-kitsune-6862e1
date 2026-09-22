// smrt-nifty-edge.js
// ============================================================
// SMRT NIFTY EDGE PRO
// Original closed-candle NIFTY 50 confluence indicator.
// No fixed accuracy is assumed or guaranteed.
// ============================================================

import { indicators } from './market.js';
import { trendIndicators } from './trend-indicators.js';

function finite(v) {
  return Number.isFinite(Number(v));
}

function atr(candles, period = 14) {
  const out = Array(candles.length).fill(null);
  let value = null;
  let seed = 0;

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
      value = seed / period;
    } else if (i > period && value !== null) {
      value = (value * (period - 1) + tr) / period;
    }

    out[i] = value;
  }

  return out;
}

function structureAt(candles, i, lookback = 10) {
  if (i < lookback + 2) {
    return { side: 0, label: 'WARMING UP', bos: false };
  }

  const prior = candles.slice(Math.max(0, i - lookback), i);
  const high = Math.max(...prior.map(c => Number(c.high)));
  const low = Math.min(...prior.map(c => Number(c.low)));
  const close = Number(candles[i].close);

  if (close > high) {
    return { side: 1, label: 'BOS UP', bos: true };
  }

  if (close < low) {
    return { side: -1, label: 'BOS DOWN', bos: true };
  }

  const recent = candles.slice(Math.max(0, i - 4), i + 1);
  const rising = recent.every((c, j, a) =>
    j === 0 || Number(c.close) >= Number(a[j - 1].close)
  );
  const falling = recent.every((c, j, a) =>
    j === 0 || Number(c.close) <= Number(a[j - 1].close)
  );

  return rising
    ? { side: 1, label: 'HH / HL', bos: false }
    : falling
      ? { side: -1, label: 'LH / LL', bos: false }
      : { side: 0, label: 'RANGE', bos: false };
}

function plan(candles, i, side, atrValue) {
  if (!side || !finite(atrValue)) return null;

  const c = candles[i];
  const entry = Number(c.close);
  const recent = candles.slice(Math.max(0, i - 6), i + 1);

  const swingLow = Math.min(...recent.map(x => Number(x.low)));
  const swingHigh = Math.max(...recent.map(x => Number(x.high)));

  let stop;
  if (side === 1) {
    stop = Math.min(
      entry - atrValue * 1.2,
      swingLow - atrValue * 0.15
    );
  } else {
    stop = Math.max(
      entry + atrValue * 1.2,
      swingHigh + atrValue * 0.15
    );
  }

  const risk = Math.abs(entry - stop);
  if (!finite(risk) || risk <= 0) return null;

  const target1 = entry + side * risk;
  const target2 = entry + side * risk * 1.5;
  const target3 = entry + side * risk * 2;

  return {
    entry,
    stop,
    target1,
    target2,
    target3,
    rr1: 1,
    rr2: 1.5,
    rr3: 2,
    risk
  };
}

export function analyseNiftyEdge(candles, options = {}) {
  if (!Array.isArray(candles) || candles.length < 30) {
    return {
      rows: [],
      latest: null
    };
  }

  const calc = indicators(candles);
  const trend = trendIndicators(candles);
  const atr14 = atr(candles, 14);
  const futuresVWAP = finite(options.futuresVWAP)
    ? Number(options.futuresVWAP)
    : null;

  const rows = Array(candles.length).fill(null);

  // Only closed candles are allowed to create actionable signals.
  const lastClosed = Math.max(0, candles.length - 2);

  for (let i = 26; i <= lastClosed; i++) {
    const close = Number(candles[i].close);
    const e9 = calc.e9?.[i];
    const e21 = calc.e21?.[i];
    const e50 = calc.e50?.[i];
    const rsi = calc.rsi?.[i];
    const hist = calc.hist?.[i];
    const prevHist = calc.hist?.[i - 1];
    const stDir = trend.direction?.[i] || 0;
    const adx = trend.adx?.[i];
    const plusDI = trend.plusDI?.[i];
    const minusDI = trend.minusDI?.[i];
    const atrValue = atr14[i];
    const structure = structureAt(candles, i);

    const ready = [
      close, e9, e21, e50, rsi, hist,
      prevHist, adx, plusDI, minusDI, atrValue
    ].every(finite);

    if (!ready) continue;

    let bull = 0;
    let bear = 0;
    const reasons = [];

    // 1-2: EMA structure
    if (e9 > e21) bull++; else if (e9 < e21) bear++;
    if (e21 > e50) bull++; else if (e21 < e50) bear++;

    // 3: Supertrend
    if (stDir === 1) bull++;
    if (stDir === -1) bear++;

    // 4: DMI direction with meaningful ADX
    if (adx >= 22 && plusDI > minusDI) bull++;
    if (adx >= 22 && minusDI > plusDI) bear++;

    // 5: RSI regime
    if (rsi >= 52 && rsi <= 68) bull++;
    if (rsi <= 48 && rsi >= 32) bear++;

    // 6: MACD histogram direction + acceleration
    if (hist > 0 && hist >= prevHist) bull++;
    if (hist < 0 && hist <= prevHist) bear++;

    // 7: structure
    if (structure.side === 1) bull++;
    if (structure.side === -1) bear++;

    // 8: VWAP / futures VWAP
    const indexVWAP = calc.vwap?.[i];
    const vwap = finite(indexVWAP) ? Number(indexVWAP) : futuresVWAP;
    if (finite(vwap)) {
      if (close > vwap) bull++;
      if (close < vwap) bear++;
    }

    // 9: candle body confirmation
    const candle = candles[i];
    const body = Math.abs(Number(candle.close) - Number(candle.open));
    const range = Math.max(0.0001, Number(candle.high) - Number(candle.low));
    const bodyRatio = body / range;
    if (bodyRatio >= 0.55) {
      if (Number(candle.close) > Number(candle.open)) bull++;
      if (Number(candle.close) < Number(candle.open)) bear++;
    }

    // 10: ATR expansion versus recent average
    const recentAtr = atr14
      .slice(Math.max(0, i - 5), i)
      .filter(finite);
    const avgAtr = recentAtr.length
      ? recentAtr.reduce((a, b) => a + Number(b), 0) / recentAtr.length
      : atrValue;

    if (atrValue >= avgAtr * 0.95) {
      if (bull > bear) bull++;
      if (bear > bull) bear++;
    }

    const maxScore = Math.max(bull, bear);
    const side = bull > bear ? 1 : bear > bull ? -1 : 0;
    const gap = Math.abs(bull - bear);

    let signal = 'NO TRADE';
    let strength = 'WAIT';

    if (side !== 0 && maxScore >= 9 && gap >= 4) {
      signal = side === 1 ? 'BUY+' : 'SELL+';
      strength = 'STRONG';
    } else if (side !== 0 && maxScore >= 8 && gap >= 3) {
      signal = side === 1 ? 'BUY' : 'SELL';
      strength = 'CONFIRMED';
    } else if (side !== 0 && maxScore >= 6) {
      strength = 'WATCH';
    }

    const tradePlan =
      signal === 'BUY+' || signal === 'SELL+' ||
      signal === 'BUY' || signal === 'SELL'
        ? plan(candles, i, side, atrValue)
        : null;

    reasons.push(
      `EMA 9/21/50 ${e9 > e21 && e21 > e50 ? 'bullish' : e9 < e21 && e21 < e50 ? 'bearish' : 'mixed'}`,
      `Supertrend ${stDir === 1 ? 'bullish' : stDir === -1 ? 'bearish' : 'flat'}`,
      `ADX ${Number(adx).toFixed(1)}`,
      `RSI ${Number(rsi).toFixed(1)}`,
      `Structure ${structure.label}`
    );

    rows[i] = {
      time: candles[i].time,
      side,
      signal,
      strength,
      score: maxScore,
      bullScore: bull,
      bearScore: bear,
      structure: structure.label,
      adx,
      rsi,
      vwap,
      plan: tradePlan,
      reasons
    };
  }

  const actionable = rows
    .filter(r =>
      r &&
      ['BUY+', 'SELL+', 'BUY', 'SELL'].includes(r.signal)
    );

  return {
    rows,
    latest: rows[lastClosed] || null,
    latestActionable: actionable.at(-1) || null
  };
}

export function backtestNiftyEdge(candles, analysis) {
  const rows = analysis?.rows || [];
  const trades = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row?.plan) continue;

    const side = row.side;
    const { entry, stop, target2 } = row.plan;
    let exit = null;
    let result = 'OPEN';

    for (let j = i + 1; j < Math.min(candles.length, i + 25); j++) {
      const c = candles[j];
      const stopHit = side === 1
        ? Number(c.low) <= stop
        : Number(c.high) >= stop;
      const targetHit = side === 1
        ? Number(c.high) >= target2
        : Number(c.low) <= target2;

      // Conservative ordering if both are touched in one candle.
      if (stopHit) {
        exit = stop;
        result = 'LOSS';
        break;
      }

      if (targetHit) {
        exit = target2;
        result = 'WIN';
        break;
      }
    }

    if (exit === null) continue;

    const points = side * (exit - entry);
    trades.push({
      time: row.time,
      signal: row.signal,
      entry,
      exit,
      result,
      points
    });
  }

  const wins = trades.filter(t => t.result === 'WIN').length;
  const losses = trades.filter(t => t.result === 'LOSS').length;
  const netPoints = trades.reduce((a, t) => a + t.points, 0);

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const t of trades) {
    equity += t.points;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  return {
    totalTrades: trades.length,
    wins,
    losses,
    winRate: trades.length ? wins / trades.length * 100 : 0,
    netPoints,
    maxDrawdown,
    trades
  };
}
