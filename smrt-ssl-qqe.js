// smrt-ssl-qqe.js
// ============================================================
// SMRT SSL + QQE COMBO
// Original NIFTY 50 closed-candle trend + momentum combination.
// No proprietary TradingView/Pine code is copied.
// ============================================================

const finite = v => Number.isFinite(Number(v));

function ema(values, period) {
  const out = Array(values.length).fill(null);
  if (!values.length) return out;

  const k = 2 / (period + 1);
  let last = Number(values[0]);

  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]);

    if (!finite(v)) continue;

    if (i === 0) {
      last = v;
    } else {
      last = v * k + last * (1 - k);
    }

    out[i] = last;
  }

  return out;
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
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);

    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;

    out[i] = avgLoss === 0
      ? 100
      : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return out;
}

function qqeStyle(closes, rsiPeriod = 14, smoothPeriod = 5, factor = 4.236) {
  const raw = rsi(closes, rsiPeriod);
  const seeded = raw.map(v => finite(v) ? Number(v) : 50);
  const smooth = ema(seeded, smoothPeriod);

  const delta = smooth.map((v, i) => {
    if (i === 0 || !finite(v) || !finite(smooth[i - 1])) return 0;
    return Math.abs(Number(v) - Number(smooth[i - 1]));
  });

  // Double-smoothed RSI volatility, similar in spirit to QQE.
  const wildPeriod = rsiPeriod * 2 - 1;
  const vol1 = ema(delta, wildPeriod);
  const vol2 = ema(vol1.map(v => finite(v) ? Number(v) : 0), wildPeriod);

  const upper = Array(closes.length).fill(null);
  const lower = Array(closes.length).fill(null);
  const state = Array(closes.length).fill(0);

  for (let i = 0; i < closes.length; i++) {
    if (!finite(smooth[i]) || !finite(vol2[i])) continue;

    const band = Number(vol2[i]) * factor;
    upper[i] = Number(smooth[i]) + band;
    lower[i] = Number(smooth[i]) - band;

    const value = Number(smooth[i]);

    if (value > 52 && value > Number(smooth[i - 1] ?? value)) {
      state[i] = 1;
    } else if (value < 48 && value < Number(smooth[i - 1] ?? value)) {
      state[i] = -1;
    } else {
      state[i] = 0;
    }
  }

  return {
    rsi: raw,
    smooth,
    upper,
    lower,
    state
  };
}

export function analyseSSLQQE(
  candles,
  {
    finalizer = null,
    mtf = null,
    sslPeriod = 10
  } = {}
) {
  if (!Array.isArray(candles) || candles.length < 35) {
    return {
      rows: [],
      latest: null,
      sslHigh: [],
      sslLow: [],
      sslTrend: [],
      qqe: null
    };
  }

  const highs = candles.map(c => Number(c.high));
  const lows = candles.map(c => Number(c.low));
  const closes = candles.map(c => Number(c.close));

  const highMA = ema(highs, sslPeriod);
  const lowMA = ema(lows, sslPeriod);

  const sslHigh = Array(candles.length).fill(null);
  const sslLow = Array(candles.length).fill(null);
  const sslTrend = Array(candles.length).fill(0);

  let hlv = 0;

  for (let i = 0; i < candles.length; i++) {
    if (![closes[i], highMA[i], lowMA[i]].every(finite)) continue;

    if (closes[i] > highMA[i]) {
      hlv = 1;
    } else if (closes[i] < lowMA[i]) {
      hlv = -1;
    }

    sslTrend[i] = hlv;

    if (hlv >= 0) {
      sslHigh[i] = highMA[i];
      sslLow[i] = lowMA[i];
    } else {
      sslHigh[i] = lowMA[i];
      sslLow[i] = highMA[i];
    }
  }

  const qqe = qqeStyle(closes);
  const rows = Array(candles.length).fill(null);
  const lastClosed = Math.max(0, candles.length - 2);

  for (let i = 20; i <= lastClosed; i++) {
    const sslSide = sslTrend[i] || 0;
    const qqeSide = qqe.state[i] || 0;

    let longScore = 0;
    let shortScore = 0;
    const reasons = [];

    if (sslSide === 1) {
      longScore += 4;
      reasons.push('SSL bullish');
    } else if (sslSide === -1) {
      shortScore += 4;
      reasons.push('SSL bearish');
    }

    if (qqeSide === 1) {
      longScore += 4;
      reasons.push('QQE momentum bullish');
    } else if (qqeSide === -1) {
      shortScore += 4;
      reasons.push('QQE momentum bearish');
    }

    const mtfOverall = mtf?.overall || 'NO TRADE';

    if (mtfOverall.includes('BUY')) {
      longScore += 2;
      reasons.push('MTF bullish');
    } else if (mtfOverall.includes('SELL')) {
      shortScore += 2;
      reasons.push('MTF bearish');
    }

    if (finalizer?.state?.includes('BUY')) {
      longScore += finalizer.state.startsWith('STRONG') ? 3 : 2;
      reasons.push('Finalizer bullish');
    } else if (finalizer?.state?.includes('SELL')) {
      shortScore += finalizer.state.startsWith('STRONG') ? 3 : 2;
      reasons.push('Finalizer bearish');
    }

    const side = longScore > shortScore ? 1 : shortScore > longScore ? -1 : 0;
    const strength = Math.max(longScore, shortScore);
    const gap = Math.abs(longScore - shortScore);

    let signal = 'NO TRADE';

    if (side === 1 && sslSide === 1 && qqeSide === 1 && strength >= 8 && gap >= 4) {
      signal = strength >= 11 ? 'LONG+' : 'LONG';
    } else if (side === -1 && sslSide === -1 && qqeSide === -1 && strength >= 8 && gap >= 4) {
      signal = strength >= 11 ? 'SHORT+' : 'SHORT';
    }

    rows[i] = {
      time: candles[i].time,
      signal,
      side: signal.startsWith('LONG') ? 1 : signal.startsWith('SHORT') ? -1 : 0,
      sslSide,
      qqeSide,
      qqeValue: qqe.smooth[i],
      score: strength,
      longScore,
      shortScore,
      reasons
    };
  }

  const latest = rows[lastClosed] || {
    time: candles[lastClosed]?.time,
    signal: 'NO TRADE',
    side: 0,
    sslSide: sslTrend[lastClosed] || 0,
    qqeSide: qqe.state[lastClosed] || 0,
    qqeValue: qqe.smooth[lastClosed],
    score: 0,
    longScore: 0,
    shortScore: 0,
    reasons: []
  };

  const plan =
    latest.signal !== 'NO TRADE'
      ? finalizer?.plan || null
      : null;

  return {
    rows,
    latest: {
      ...latest,
      plan
    },
    sslHigh,
    sslLow,
    sslTrend,
    qqe
  };
}
