// smrt-gainz-ssl-combo.js
// ============================================================
// SMRT GAINZ + SSL COMBO
// Closed-candle NIFTY 50 decision support only.
//
// SIGNAL INTEGRITY:
// 1. Missing/null/undefined/blank values are NEVER converted to zero.
// 2. Missing mandatory indicators => NOT READY.
// 3. Historical candles NEVER use today's/current MTF/finalizer snapshot.
// 4. Historical MTF/finalizer values must be timestamped.
// 5. Only closed candles are evaluated.
// ============================================================


// ------------------------------------------------------------
// SAFE NUMBER HELPERS
// ------------------------------------------------------------

const finite = (v) =>
  v !== null &&
  v !== undefined &&
  v !== '' &&
  Number.isFinite(Number(v));

const numOrNull = (v) => (finite(v) ? Number(v) : null);


// ------------------------------------------------------------
// EMA
// ------------------------------------------------------------

function ema(values, period) {
  const out = Array(values.length).fill(null);
  const k = 2 / (period + 1);

  let last = null;

  for (let i = 0; i < values.length; i++) {
    if (!finite(values[i])) {
      // Do not manufacture a value from missing data.
      continue;
    }

    const v = Number(values[i]);

    if (last === null) {
      last = v;
    } else {
      last = v * k + last * (1 - k);
    }

    out[i] = last;
  }

  return out;
}


// ------------------------------------------------------------
// WMA
// ------------------------------------------------------------

function wma(values, period) {
  const out = Array(values.length).fill(null);
  const denom = (period * (period + 1)) / 2;

  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    let ok = true;

    for (let j = 0; j < period; j++) {
      const raw = values[i - j];

      if (!finite(raw)) {
        ok = false;
        break;
      }

      sum += Number(raw) * (period - j);
    }

    if (ok) {
      out[i] = sum / denom;
    }
  }

  return out;
}


// ------------------------------------------------------------
// HMA
// ------------------------------------------------------------

function hma(values, period) {
  const half = Math.max(1, Math.floor(period / 2));
  const root = Math.max(1, Math.round(Math.sqrt(period)));

  const w1 = wma(values, half);
  const w2 = wma(values, period);

  const diff = values.map((_, i) => {
    if (!finite(w1[i]) || !finite(w2[i])) {
      return null;
    }

    return 2 * Number(w1[i]) - Number(w2[i]);
  });

  return wma(diff, root);
}


// ------------------------------------------------------------
// RSI
// ------------------------------------------------------------

function rsi(values, period = 14) {
  const out = Array(values.length).fill(null);

  if (values.length <= period) {
    return out;
  }

  // RSI cannot be calculated safely when required source candles
  // are missing.
  for (let i = 0; i <= period; i++) {
    if (!finite(values[i])) {
      return out;
    }
  }

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const current = Number(values[i]);
    const previous = Number(values[i - 1]);

    const d = current - previous;

    gain += Math.max(d, 0);
    loss += Math.max(-d, 0);
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  out[period] =
    avgLoss === 0
      ? 100
      : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    if (!finite(values[i]) || !finite(values[i - 1])) {
      out[i] = null;
      continue;
    }

    const d = Number(values[i]) - Number(values[i - 1]);

    avgGain =
      (avgGain * (period - 1) + Math.max(d, 0)) /
      period;

    avgLoss =
      (avgLoss * (period - 1) + Math.max(-d, 0)) /
      period;

    out[i] =
      avgLoss === 0
        ? 100
        : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return out;
}


// ------------------------------------------------------------
// ATR
// ------------------------------------------------------------

function atr(candles, period = 14) {
  const tr = candles.map((c, i) => {
    if (
      !finite(c?.high) ||
      !finite(c?.low)
    ) {
      return null;
    }

    const high = Number(c.high);
    const low = Number(c.low);

    if (i === 0) {
      return high - low;
    }

    if (!finite(candles[i - 1]?.close)) {
      return null;
    }

    const previousClose = Number(candles[i - 1].close);

    return Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    );
  });

  return ema(tr, period);
}


// ------------------------------------------------------------
// PERCENT RANK
// ------------------------------------------------------------

function percentRank(values, index, lookback = 100) {
  const current = values[index];

  if (!finite(current)) {
    return null;
  }

  const start = Math.max(0, index - lookback + 1);

  const sample = values
    .slice(start, index + 1)
    .filter(finite)
    .map(Number);

  if (sample.length < 10) {
    return null;
  }

  const below = sample.filter(
    (v) => v <= Number(current),
  ).length;

  return (below / sample.length) * 100;
}


// ------------------------------------------------------------
// QQE STATE
// ------------------------------------------------------------

function qqeState(closes) {
  const raw = rsi(closes, 14);

  // IMPORTANT:
  // Missing RSI is NOT converted to neutral 50.
  const smoothInput = raw.map((v) =>
    finite(v) ? Number(v) : null,
  );

  const smooth = ema(smoothInput, 5);

  // null = unavailable
  // 0    = valid neutral state
  // 1    = bullish
  // -1   = bearish
  const state = Array(closes.length).fill(null);

  for (let i = 1; i < closes.length; i++) {
    if (
      !finite(smooth[i]) ||
      !finite(smooth[i - 1])
    ) {
      state[i] = null;
      continue;
    }

    if (
      smooth[i] > 52 &&
      smooth[i] >= smooth[i - 1]
    ) {
      state[i] = 1;
    } else if (
      smooth[i] < 48 &&
      smooth[i] <= smooth[i - 1]
    ) {
      state[i] = -1;
    } else {
      state[i] = 0;
    }
  }

  return {
    raw,
    smooth,
    state,
  };
}


// ------------------------------------------------------------
// HISTORICAL SNAPSHOT LOOKUP
// ------------------------------------------------------------
//
// Historical candles must only see information that existed
// at or before that candle's timestamp.
//
// Expected historical structure:
//
// mtf = [
//   { time: 1710000000000, overall: 'BUY' },
//   { time: 1710000300000, overall: 'SELL' }
// ];
//
// finalizer = [
//   {
//     time: 1710000000000,
//     state: 'BUY',
//     plan: {...}
//   }
// ];
//
// A single object is considered a CURRENT snapshot and is
// deliberately NOT copied backwards into historical candles.
// ------------------------------------------------------------

function valueAtTime(source, candleTime) {
  if (!Array.isArray(source)) {
    return null;
  }

  if (!finite(candleTime)) {
    return null;
  }

  const target = Number(candleTime);

  let result = null;

  for (const item of source) {
    if (
      !item ||
      !finite(item.time)
    ) {
      continue;
    }

    const itemTime = Number(item.time);

    if (itemTime <= target) {
      result = item;
    } else {
      break;
    }
  }

  return result;
}


// ------------------------------------------------------------
// MAIN ANALYSIS
// ------------------------------------------------------------

export function analyseGainzSSL(
  candles,
  {
    finalizer = null,
    mtf = null,
    signalExpiry = 3,
  } = {},
) {
  if (
    !Array.isArray(candles) ||
    candles.length < 70
  ) {
    return {
      rows: [],
      latest: null,
      baseline: [],
      upperChannel: [],
      lowerChannel: [],
      ssl1: [],
      ssl2: [],
      exitLine: [],
      atr: [],
      qqe: {
        raw: [],
        smooth: [],
        state: [],
      },
    };
  }


  // ----------------------------------------------------------
  // SAFE OHLC DATA
  // ----------------------------------------------------------

  const closes = candles.map((c) =>
    numOrNull(c?.close),
  );

  const highs = candles.map((c) =>
    numOrNull(c?.high),
  );

  const lows = candles.map((c) =>
    numOrNull(c?.low),
  );


  // ----------------------------------------------------------
  // SSL HYBRID
  // ----------------------------------------------------------

  const baseline = hma(closes, 60);

  const baseHigh = hma(highs, 60);
  const baseLow = hma(lows, 60);

  const ssl2High = ema(highs, 5);
  const ssl2Low = ema(lows, 5);

  const exitHigh = hma(highs, 15);
  const exitLow = hma(lows, 15);

  const atr14 = atr(candles, 14);


  // ----------------------------------------------------------
  // BASELINE CHANNEL RANGE
  // ----------------------------------------------------------

  const ranges = candles.map((c, i) => {
    if (
      !finite(c?.high) ||
      !finite(c?.low)
    ) {
      return null;
    }

    const high = Number(c.high);
    const low = Number(c.low);

    if (i === 0) {
      return high - low;
    }

    if (!finite(candles[i - 1]?.close)) {
      return null;
    }

    const previousClose =
      Number(candles[i - 1].close);

    return Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    );
  });

  const rangeEma = ema(ranges, 60);


  const upperChannel = baseline.map(
    (v, i) =>
      finite(v) && finite(rangeEma[i])
        ? Number(v) +
          Number(rangeEma[i]) * 0.2
        : null,
  );


  const lowerChannel = baseline.map(
    (v, i) =>
      finite(v) && finite(rangeEma[i])
        ? Number(v) -
          Number(rangeEma[i]) * 0.2
        : null,
  );


  // ----------------------------------------------------------
  // SSL LINES
  // ----------------------------------------------------------

  const ssl1 =
    Array(candles.length).fill(null);

  const ssl2 =
    Array(candles.length).fill(null);

  const exitLine =
    Array(candles.length).fill(null);


  let hlv1 = 0;
  let hlv2 = 0;
  let hlv3 = 0;


  for (let i = 0; i < candles.length; i++) {
    const close = closes[i];


    // SSL1
    if (
      [close, baseHigh[i], baseLow[i]]
        .every(finite)
    ) {
      if (close > baseHigh[i]) {
        hlv1 = 1;
      } else if (close < baseLow[i]) {
        hlv1 = -1;
      }

      ssl1[i] =
        hlv1 < 0
          ? baseHigh[i]
          : baseLow[i];
    }


    // SSL2
    if (
      [close, ssl2High[i], ssl2Low[i]]
        .every(finite)
    ) {
      if (close > ssl2High[i]) {
        hlv2 = 1;
      } else if (close < ssl2Low[i]) {
        hlv2 = -1;
      }

      ssl2[i] =
        hlv2 < 0
          ? ssl2High[i]
          : ssl2Low[i];
    }


    // EXIT LINE
    if (
      [close, exitHigh[i], exitLow[i]]
        .every(finite)
    ) {
      if (close > exitHigh[i]) {
        hlv3 = 1;
      } else if (close < exitLow[i]) {
        hlv3 = -1;
      }

      exitLine[i] =
        hlv3 < 0
          ? exitHigh[i]
          : exitLow[i];
    }
  }


  // ----------------------------------------------------------
  // QQE
  // ----------------------------------------------------------

  const qqe = qqeState(closes);


  // ----------------------------------------------------------
  // RESULT ROWS
  // ----------------------------------------------------------

  const rows =
    Array(candles.length).fill(null);


  // Last candle is assumed live/open.
  // Analyse only completed candle.
  const lastClosed =
    Math.max(0, candles.length - 2);


  let pendingSide = 0;
  let pendingAge = 999;


  // ----------------------------------------------------------
  // CLOSED-CANDLE ANALYSIS
  // ----------------------------------------------------------

  for (
    let i = 61;
    i <= lastClosed;
    i++
  ) {
    const candleTime =
      candles[i]?.time;


    // Historical snapshot lookup.
    //
    // IMPORTANT:
    // Current mtf/finalizer object is never
    // copied into past candles.
    const mtfAtCandle =
      valueAtTime(mtf, candleTime);

    const finalizerAtCandle =
      valueAtTime(finalizer, candleTime);


    const close = closes[i];
    const a = atr14[i];

    const base = baseline[i];

    const s1 = ssl1[i];
    const s2 = ssl2[i];

    const ex = exitLine[i];

    const qqeSide =
      qqe.state[i];


    // --------------------------------------------------------
    // MANDATORY INDICATOR READINESS
    // --------------------------------------------------------

    const indicatorsReady =
      finite(close) &&
      finite(a) &&
      finite(base) &&
      finite(s1) &&
      finite(s2) &&
      finite(ex) &&
      finite(upperChannel[i]) &&
      finite(lowerChannel[i]) &&
      finite(qqe.smooth[i]) &&
      qqeSide !== null &&
      qqeSide !== undefined;


    if (!indicatorsReady) {
      rows[i] = {
        time: candleTime,

        signal: 'NOT READY',

        side: 0,
        score: 0,

        longScore: 0,
        shortScore: 0,

        qqeSide: null,
        qqeValue: null,

        baselineSide: 0,
        sslSide: 0,
        continuationSide: 0,

        riskLevel: null,
        riskPercentile: null,

        entryDistance: null,

        plan: null,

        reasons: [
          'Required indicator data unavailable',
        ],
      };

      continue;
    }


    // --------------------------------------------------------
    // BASELINE
    // --------------------------------------------------------

    const baselineBull =
      close > upperChannel[i];

    const baselineBear =
      close < lowerChannel[i];


    // --------------------------------------------------------
    // SSL1
    // --------------------------------------------------------

    const sslBull =
      close > s1;

    const sslBear =
      close < s1;


    // --------------------------------------------------------
    // SSL2 CONTINUATION
    // --------------------------------------------------------

    const lowerHalf =
      close - Number(a) * 0.9;

    const upperHalf =
      close + Number(a) * 0.9;


    const continuationBull =
      lowerHalf < s2 &&
      close > base &&
      close > s2;


    const continuationBear =
      upperHalf > s2 &&
      close < base &&
      close < s2;


    // --------------------------------------------------------
    // EXIT CROSS
    // --------------------------------------------------------

    const prevClose =
      closes[i - 1];

    const prevExit =
      exitLine[i - 1];


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


    // --------------------------------------------------------
    // SCORE
    // --------------------------------------------------------

    let longScore = 0;
    let shortScore = 0;

    const reasons = [];


    // BASELINE
    if (baselineBull) {
      longScore += 3;

      reasons.push(
        'Above SSL baseline channel',
      );

    } else if (baselineBear) {
      shortScore += 3;

      reasons.push(
        'Below SSL baseline channel',
      );
    }


    // SSL1
    if (sslBull) {
      longScore += 2;

      reasons.push(
        'SSL1 bullish',
      );

    } else if (sslBear) {
      shortScore += 2;

      reasons.push(
        'SSL1 bearish',
      );
    }


    // SSL2
    if (continuationBull) {
      longScore += 3;

      reasons.push(
        'SSL2 continuation bullish',
      );

    } else if (continuationBear) {
      shortScore += 3;

      reasons.push(
        'SSL2 continuation bearish',
      );
    }


    // QQE
    if (qqeSide === 1) {
      longScore += 2;

      reasons.push(
        'QQE bullish',
      );

    } else if (qqeSide === -1) {
      shortScore += 2;

      reasons.push(
        'QQE bearish',
      );
    }


    // FRESH EXIT TRIGGER
    if (pendingSide === 1) {
      longScore += 2;

      reasons.push(
        'Fresh exit-line long trigger',
      );

    } else if (pendingSide === -1) {
      shortScore += 2;

      reasons.push(
        'Fresh exit-line short trigger',
      );
    }


    // --------------------------------------------------------
    // HISTORICAL MTF
    // --------------------------------------------------------
    //
    // Only timestamp-correct historical MTF may contribute.
    // Current snapshot contributes NOTHING to old candles.
    // --------------------------------------------------------

    if (
      typeof mtfAtCandle?.overall === 'string' &&
      mtfAtCandle.overall.includes('BUY')
    ) {
      longScore += 2;

      reasons.push(
        'MTF bullish',
      );

    } else if (
      typeof mtfAtCandle?.overall === 'string' &&
      mtfAtCandle.overall.includes('SELL')
    ) {
      shortScore += 2;

      reasons.push(
        'MTF bearish',
      );
    }


    // --------------------------------------------------------
    // HISTORICAL FINALIZER
    // --------------------------------------------------------

    if (
      typeof finalizerAtCandle?.state === 'string' &&
      finalizerAtCandle.state.includes('BUY')
    ) {
      longScore +=
        finalizerAtCandle.state.startsWith(
          'STRONG',
        )
          ? 3
          : 2;

      reasons.push(
        'Trade Finalizer bullish',
      );

    } else if (
      typeof finalizerAtCandle?.state === 'string' &&
      finalizerAtCandle.state.includes('SELL')
    ) {
      shortScore +=
        finalizerAtCandle.state.startsWith(
          'STRONG',
        )
          ? 3
          : 2;

      reasons.push(
        'Trade Finalizer bearish',
      );
    }


    // --------------------------------------------------------
    // FINAL SIDE
    // --------------------------------------------------------

    const side =
      longScore > shortScore
        ? 1
        : shortScore > longScore
          ? -1
          : 0;


    const strength =
      Math.max(
        longScore,
        shortScore,
      );


    const gap =
      Math.abs(
        longScore - shortScore,
      );


    // --------------------------------------------------------
    // SIGNAL
    // --------------------------------------------------------

    let signal = 'NO TRADE';


    if (
      side === 1 &&
      baselineBull &&
      sslBull &&
      qqeSide === 1 &&
      strength >= 10 &&
      gap >= 4
    ) {
      signal =
        strength >= 14
          ? 'LONG+'
          : 'LONG';

    } else if (
      side === -1 &&
      baselineBear &&
      sslBear &&
      qqeSide === -1 &&
      strength >= 10 &&
      gap >= 4
    ) {
      signal =
        strength >= 14
          ? 'SHORT+'
          : 'SHORT';
    }


    // --------------------------------------------------------
    // RISK
    // --------------------------------------------------------

    const riskPercentile =
      percentRank(
        atr14,
        i,
        100,
      );


    const riskLevel =
      !finite(riskPercentile)
        ? 'UNKNOWN'
        : riskPercentile > 75
          ? 'HIGH'
          : riskPercentile < 25
            ? 'LOW'
            : 'NORMAL';


    // --------------------------------------------------------
    // ENTRY DISTANCE
    // --------------------------------------------------------

    const atrValue =
      Number(a);


    const distance =
      atrValue > 0
        ? Math.abs(
            close - base,
          ) / atrValue
        : null;


    const entryDistance =
      !finite(distance)
        ? null
        : distance < 1
          ? 'NEAR'
          : distance < 2
            ? 'EXTENDED'
            : 'FAR';


    // --------------------------------------------------------
    // HIGH-RISK REJECTION
    // --------------------------------------------------------

    if (
      signal !== 'NO TRADE' &&
      riskLevel === 'HIGH' &&
      entryDistance === 'FAR'
    ) {
      signal = 'NO TRADE';

      reasons.push(
        'Rejected: high volatility + far from baseline',
      );
    }


    // --------------------------------------------------------
    // HISTORICAL PLAN ONLY
    // --------------------------------------------------------

    const plan =
      signal !== 'NO TRADE'
        ? finalizerAtCandle?.plan ?? null
        : null;


    // --------------------------------------------------------
    // STORE RESULT
    // --------------------------------------------------------

    rows[i] = {
      time: candleTime,

      signal,

      side:
        signal.startsWith('LONG')
          ? 1
          : signal.startsWith('SHORT')
            ? -1
            : 0,

      score: strength,

      longScore,
      shortScore,

      qqeSide,

      qqeValue:
        finite(qqe.smooth[i])
          ? Number(qqe.smooth[i])
          : null,

      baselineSide:
        baselineBull
          ? 1
          : baselineBear
            ? -1
            : 0,

      sslSide:
        sslBull
          ? 1
          : sslBear
            ? -1
            : 0,

      continuationSide:
        continuationBull
          ? 1
          : continuationBear
            ? -1
            : 0,

      riskLevel,
      riskPercentile,

      entryDistance,

      plan,

      reasons,
    };
  }


  // ----------------------------------------------------------
  // LATEST CLOSED CANDLE
  // ----------------------------------------------------------

  const latest =
    rows[lastClosed] || null;


  // ----------------------------------------------------------
  // RETURN
  // ----------------------------------------------------------

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

    qqe,
  };
}
