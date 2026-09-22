// smrt-gainz-ssl-combo.js
// ============================================================
// SMRT GAINZ + SSL COMBO
// Built from the user-supplied SSL Hybrid concepts plus the
// uploaded strategy-builder confirmation workflow.
// Closed-candle NIFTY 50 decision support only.
// ============================================================

const finite = v => Number.isFinite(Number(v));

function ema(values, period) {
  const out = Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let last = null;

  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]);
    if (!finite(v)) continue;

    if (last === null) last = v;
    else last = v * k + last * (1 - k);

    out[i] = last;
  }

  return out;
}

function wma(values, period) {
  const out = Array(values.length).fill(null);
  const denom = period * (period + 1) / 2;

  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    let ok = true;

    for (let j = 0; j < period; j++) {
      const v = Number(values[i - j]);
      if (!finite(v)) {
        ok = false;
        break;
      }
      sum += v * (period - j);
    }

    if (ok) out[i] = sum / denom;
  }

  return out;
}

function hma(values, period) {
  const half = Math.max(1, Math.floor(period / 2));
  const root = Math.max(1, Math.round(Math.sqrt(period)));
  const w1 = wma(values, half);
  const w2 = wma(values, period);
  const diff = values.map((_, i) =>
    finite(w1[i]) && finite(w2[i])
      ? 2 * Number(w1[i]) - Number(w2[i])
      : null
  );
  return wma(diff, root);
}

function rsi(values, period = 14) {
  const out = Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const d = Number(values[i]) - Number(values[i - 1]);
    gain += Math.max(d, 0);
    loss += Math.max(-d, 0);
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  out[period] = avgLoss === 0
    ? 100
    : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const d = Number(values[i]) - Number(values[i - 1]);
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;

    out[i] = avgLoss === 0
      ? 100
      : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return out;
}

function atr(candles, period = 14) {
  const tr = candles.map((c, i) => {
    if (i === 0) return Number(c.high) - Number(c.low);
    const p = Number(candles[i - 1].close);
    return Math.max(
      Number(c.high) - Number(c.low),
      Math.abs(Number(c.high) - p),
      Math.abs(Number(c.low) - p)
    );
  });

  return ema(tr, period);
}

function percentRank(values, index, lookback = 100) {
  const current = values[index];
  if (!finite(current)) return null;

  const start = Math.max(0, index - lookback + 1);
  const sample = values.slice(start, index + 1).filter(finite);

  if (sample.length < 10) return null;

  const below = sample.filter(v => Number(v) <= Number(current)).length;
  return below / sample.length * 100;
}

function qqeState(closes) {
  const raw = rsi(closes, 14);
  const smooth = ema(raw.map(v => finite(v) ? Number(v) : 50), 5);
  const state = Array(closes.length).fill(0);

  for (let i = 1; i < closes.length; i++) {
    if (!finite(smooth[i]) || !finite(smooth[i - 1])) continue;

    if (smooth[i] > 52 && smooth[i] >= smooth[i - 1]) state[i] = 1;
    else if (smooth[i] < 48 && smooth[i] <= smooth[i - 1]) state[i] = -1;
  }

  return { raw, smooth, state };
}

export function analyseGainzSSL(
  candles,
  {
    finalizer = null,
    mtf = null,
    signalExpiry = 3
  } = {}
) {
  if (!Array.isArray(candles) || candles.length < 70) {
    return {
      rows: [],
      latest: null,
      baseline: [],
      upperChannel: [],
      lowerChannel: [],
      ssl1: [],
      ssl2: [],
      exitLine: []
    };
  }

  const closes = candles.map(c => Number(c.close));
  const highs = candles.map(c => Number(c.high));
  const lows = candles.map(c => Number(c.low));

  // User-supplied SSL Hybrid defaults:
  // baseline HMA 60, continuation SSL length 5, exit HMA 15, ATR 14.
  const baseline = hma(closes, 60);
  const baseHigh = hma(highs, 60);
  const baseLow = hma(lows, 60);
  const ssl2High = ema(highs, 5);
  const ssl2Low = ema(lows, 5);
  const exitHigh = hma(highs, 15);
  const exitLow = hma(lows, 15);
  const atr14 = atr(candles, 14);
  const rangeEma = ema(
    candles.map((c, i) => {
      if (i === 0) return Number(c.high) - Number(c.low);
      const p = Number(candles[i - 1].close);
      return Math.max(
        Number(c.high) - Number(c.low),
        Math.abs(Number(c.high) - p),
        Math.abs(Number(c.low) - p)
      );
    }),
    60
  );

  const upperChannel = baseline.map((v, i) =>
    finite(v) && finite(rangeEma[i])
      ? Number(v) + Number(rangeEma[i]) * 0.2
      : null
  );

  const lowerChannel = baseline.map((v, i) =>
    finite(v) && finite(rangeEma[i])
      ? Number(v) - Number(rangeEma[i]) * 0.2
      : null
  );

  const ssl1 = Array(candles.length).fill(null);
  const ssl2 = Array(candles.length).fill(null);
  const exitLine = Array(candles.length).fill(null);

  let hlv1 = 0;
  let hlv2 = 0;
  let hlv3 = 0;

  for (let i = 0; i < candles.length; i++) {
    const close = closes[i];

    if ([close, baseHigh[i], baseLow[i]].every(finite)) {
      if (close > baseHigh[i]) hlv1 = 1;
      else if (close < baseLow[i]) hlv1 = -1;

      ssl1[i] = hlv1 < 0 ? baseHigh[i] : baseLow[i];
    }

    if ([close, ssl2High[i], ssl2Low[i]].every(finite)) {
      if (close > ssl2High[i]) hlv2 = 1;
      else if (close < ssl2Low[i]) hlv2 = -1;

      ssl2[i] = hlv2 < 0 ? ssl2High[i] : ssl2Low[i];
    }

    if ([close, exitHigh[i], exitLow[i]].every(finite)) {
      if (close > exitHigh[i]) hlv3 = 1;
      else if (close < exitLow[i]) hlv3 = -1;

      exitLine[i] = hlv3 < 0 ? exitHigh[i] : exitLow[i];
    }
  }

  const qqe = qqeState(closes);
  const rows = Array(candles.length).fill(null);
  const lastClosed = Math.max(0, candles.length - 2);

  let pendingSide = 0;
  let pendingAge = 999;

  for (let i = 61; i <= lastClosed; i++) {
    const close = closes[i];
    const a = atr14[i];
    const base = baseline[i];
    const s1 = ssl1[i];
    const s2 = ssl2[i];
    const ex = exitLine[i];
    const qqeSide = qqe.state[i] || 0;

    if (![close, a, base, s1, s2, ex].every(finite)) continue;

    const baselineBull = close > upperChannel[i];
    const baselineBear = close < lowerChannel[i];
    const sslBull = close > s1;
    const sslBear = close < s1;

    const lowerHalf = close - Number(a) * 0.9;
    const upperHalf = close + Number(a) * 0.9;

    const continuationBull =
      lowerHalf < s2 &&
      close > base &&
      close > s2;

    const continuationBear =
      upperHalf > s2 &&
      close < base &&
      close < s2;

    const prevClose = closes[i - 1];
    const prevExit = exitLine[i - 1];

    const exitCrossLong =
      finite(prevClose) &&
      finite(prevExit) &&
      prevClose <= prevExit &&
      close > ex;

    const exitCrossShort =
      finite(prevClose) &&
      finite(prevExit) &&
      prevClose >= prevExit &&
      close < ex;

    if (exitCrossLong) {
      pendingSide = 1;
      pendingAge = 0;
    } else if (exitCrossShort) {
      pendingSide = -1;
      pendingAge = 0;
    } else {
      pendingAge += 1;
    }

    if (pendingAge > signalExpiry) {
      pendingSide = 0;
    }

    let longScore = 0;
    let shortScore = 0;
    const reasons = [];

    if (baselineBull) {
      longScore += 3;
      reasons.push('Above SSL baseline channel');
    } else if (baselineBear) {
      shortScore += 3;
      reasons.push('Below SSL baseline channel');
    }

    if (sslBull) {
      longScore += 2;
      reasons.push('SSL1 bullish');
    } else if (sslBear) {
      shortScore += 2;
      reasons.push('SSL1 bearish');
    }

    if (continuationBull) {
      longScore += 3;
      reasons.push('SSL2 continuation bullish');
    } else if (continuationBear) {
      shortScore += 3;
      reasons.push('SSL2 continuation bearish');
    }

    if (qqeSide === 1) {
      longScore += 2;
      reasons.push('QQE bullish');
    } else if (qqeSide === -1) {
      shortScore += 2;
      reasons.push('QQE bearish');
    }

    if (pendingSide === 1) {
      longScore += 2;
      reasons.push('Fresh exit-line long trigger');
    } else if (pendingSide === -1) {
      shortScore += 2;
      reasons.push('Fresh exit-line short trigger');
    }

    if (mtf?.overall?.includes('BUY')) {
      longScore += 2;
      reasons.push('MTF bullish');
    } else if (mtf?.overall?.includes('SELL')) {
      shortScore += 2;
      reasons.push('MTF bearish');
    }

    if (finalizer?.state?.includes('BUY')) {
      longScore += finalizer.state.startsWith('STRONG') ? 3 : 2;
      reasons.push('Trade Finalizer bullish');
    } else if (finalizer?.state?.includes('SELL')) {
      shortScore += finalizer.state.startsWith('STRONG') ? 3 : 2;
      reasons.push('Trade Finalizer bearish');
    }

    const side = longScore > shortScore ? 1 : shortScore > longScore ? -1 : 0;
    const strength = Math.max(longScore, shortScore);
    const gap = Math.abs(longScore - shortScore);

    let signal = 'NO TRADE';

    if (
      side === 1 &&
      baselineBull &&
      sslBull &&
      qqeSide === 1 &&
      strength >= 10 &&
      gap >= 4
    ) {
      signal = strength >= 14 ? 'LONG+' : 'LONG';
    } else if (
      side === -1 &&
      baselineBear &&
      sslBear &&
      qqeSide === -1 &&
      strength >= 10 &&
      gap >= 4
    ) {
      signal = strength >= 14 ? 'SHORT+' : 'SHORT';
    }

    const riskPercentile = percentRank(atr14, i, 100);
    const riskLevel =
      !finite(riskPercentile)
        ? 'NORMAL'
        : riskPercentile > 75
          ? 'HIGH'
          : riskPercentile < 25
            ? 'LOW'
            : 'NORMAL';

    const distance =
      Math.abs(close - base) / Math.max(0.0001, Number(a));

    const entryDistance =
      distance < 1
        ? 'NEAR'
        : distance < 2
          ? 'EXTENDED'
          : 'FAR';

    // High-risk + far entries are rejected.
    if (
      signal !== 'NO TRADE' &&
      riskLevel === 'HIGH' &&
      entryDistance === 'FAR'
    ) {
      signal = 'NO TRADE';
      reasons.push('Rejected: high volatility + far from baseline');
    }

    const plan =
      signal !== 'NO TRADE'
        ? finalizer?.plan || null
        : null;

    rows[i] = {
      time: candles[i].time,
      signal,
      side: signal.startsWith('LONG') ? 1 : signal.startsWith('SHORT') ? -1 : 0,
      score: strength,
      longScore,
      shortScore,
      qqeSide,
      qqeValue: qqe.smooth[i],
      baselineSide: baselineBull ? 1 : baselineBear ? -1 : 0,
      sslSide: sslBull ? 1 : sslBear ? -1 : 0,
      continuationSide: continuationBull ? 1 : continuationBear ? -1 : 0,
      riskLevel,
      riskPercentile,
      entryDistance,
      plan,
      reasons
    };
  }

  const latest = rows[lastClosed] || null;

  return {
    rows,
    latest,
    baseline,
    upperChannel,
    lowerChannel,
    ssl1,
    ssl2,
    exitLine,
    atr: atr14,
    qqe
  };
}
