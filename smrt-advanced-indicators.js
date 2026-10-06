// smrt-advanced-indicators.js
// ============================================================
// SMRT ADVANCED INDICATOR ENGINE - NIFTY 50
//
// Calculates the advanced technical indicators used by
// smrt-all-indicators.js.
//
// SAFETY:
// - Missing data => WAIT
// - Invalid calculations => WAIT
// - No indicator can manufacture BUY/SELL from missing data
// - No automatic order placement
// ============================================================

const finite = value =>
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

const num = value =>
  finite(value) ? Number(value) : NaN;

const wait = (value = null, reason = 'NOT READY') => ({
  signal: 'WAIT',
  side: 0,
  value,
  reason
});

const bullish = (value = null, reason = '') => ({
  signal: 'BULLISH',
  side: 1,
  value,
  reason
});

const bearish = (value = null, reason = '') => ({
  signal: 'BEARISH',
  side: -1,
  value,
  reason
});

const neutral = (value = null, reason = '') => ({
  signal: 'WAIT',
  side: 0,
  value,
  reason
});

const validCandles = candles => {
  if (!Array.isArray(candles) || candles.some(c =>
    !['open','high','low','close'].every(k => finite(c?.[k])) ||
    Number(c.high) < Math.max(Number(c.open), Number(c.close)) ||
    Number(c.low) > Math.min(Number(c.open), Number(c.close)) || Number(c.high) < Number(c.low))) return [];
  return candles.map(c => ({...c, open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)}));
};

const closes = candles =>
  candles.map(c => num(c.close));

const highs = candles =>
  candles.map(c => num(c.high));

const lows = candles =>
  candles.map(c => num(c.low));

const opens = candles =>
  candles.map(c => num(c.open));

const volumes = candles =>
  candles.map(c => num(c.volume));

const last = array =>
  Array.isArray(array) && array.length
    ? array[array.length - 1]
    : NaN;


// ============================================================
// BASIC MATH
// ============================================================

function sma(values, period) {
  if (
    !Array.isArray(values) ||
    period <= 0 ||
    values.length < period
  ) {
    return NaN;
  }

  const window =
    values.slice(-period);

  if (!window.every(finite)) {
    return NaN;
  }

  return (
    window.reduce(
      (sum, value) => sum + Number(value),
      0
    ) / period
  );
}


function smaSeries(values, period) {
  const result =
    new Array(values.length).fill(NaN);

  if (
    !Array.isArray(values) ||
    period <= 0
  ) {
    return result;
  }

  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    const value = Number(values[i]);

    if (!Number.isFinite(value)) {
      continue;
    }

    sum += value;

    if (i >= period) {
      const old =
        Number(values[i - period]);

      if (Number.isFinite(old)) {
        sum -= old;
      }
    }

    if (i >= period - 1) {
      const window =
        values.slice(
          i - period + 1,
          i + 1
        );

      if (window.every(finite)) {
        result[i] =
          sum / period;
      }
    }
  }

  return result;
}


function emaSeries(values, period) {
  const result =
    new Array(values.length).fill(NaN);

  if (
    !Array.isArray(values) ||
    period <= 0 ||
    values.length < period
  ) {
    return result;
  }

  const seed =
    values.slice(0, period);

  if (!seed.every(finite)) {
    return result;
  }

  let previous =
    seed.reduce(
      (sum, value) =>
        sum + Number(value),
      0
    ) / period;

  result[period - 1] =
    previous;

  const multiplier =
    2 / (period + 1);

  for (
    let i = period;
    i < values.length;
    i++
  ) {
    const value =
      Number(values[i]);

    if (!Number.isFinite(value)) {
      continue;
    }

    previous =
      (
        value - previous
      ) * multiplier +
      previous;

    result[i] =
      previous;
  }

  return result;
}


function rmaSeries(values, period) {
  const result =
    new Array(values.length).fill(NaN);

  if (
    !Array.isArray(values) ||
    period <= 0 ||
    values.length < period
  ) {
    return result;
  }

  const seed =
    values.slice(0, period);

  if (!seed.every(finite)) {
    return result;
  }

  let previous =
    seed.reduce(
      (sum, value) =>
        sum + Number(value),
      0
    ) / period;

  result[period - 1] =
    previous;

  for (
    let i = period;
    i < values.length;
    i++
  ) {
    const value =
      Number(values[i]);

    if (!Number.isFinite(value)) {
      continue;
    }

    previous =
      (
        previous *
        (period - 1) +
        value
      ) / period;

    result[i] =
      previous;
  }

  return result;
}


function highest(values, period) {
  if (
    !Array.isArray(values) ||
    values.length < period
  ) {
    return NaN;
  }

  const window =
    values.slice(-period);

  if (!window.every(finite)) {
    return NaN;
  }

  return Math.max(
    ...window.map(Number)
  );
}


function lowest(values, period) {
  if (
    !Array.isArray(values) ||
    values.length < period
  ) {
    return NaN;
  }

  const window =
    values.slice(-period);

  if (!window.every(finite)) {
    return NaN;
  }

  return Math.min(
    ...window.map(Number)
  );
}


function rocSeries(values, period) {
  const result =
    new Array(values.length).fill(NaN);

  for (
    let i = period;
    i < values.length;
    i++
  ) {
    const previous =
      Number(values[i - period]);

    const current =
      Number(values[i]);

    if (
      !Number.isFinite(previous) ||
      !Number.isFinite(current) ||
      previous === 0
    ) {
      continue;
    }

    result[i] =
      (
        (
          current - previous
        ) /
        previous
      ) * 100;
  }

  return result;
}


function wma(values, period) {
  if (
    !Array.isArray(values) ||
    values.length < period
  ) {
    return NaN;
  }

  const window =
    values.slice(-period);

  if (!window.every(finite)) {
    return NaN;
  }

  let weighted = 0;
  let divisor = 0;

  for (
    let i = 0;
    i < period;
    i++
  ) {
    const weight =
      i + 1;

    weighted +=
      Number(window[i]) *
      weight;

    divisor +=
      weight;
  }

  return divisor
    ? weighted / divisor
    : NaN;
}


// ============================================================
// RSI
// Source default: 14
// ============================================================

function calculateRsi(values, period = 14) {
  if (
    !Array.isArray(values) ||
    values.length <= period
  ) {
    return NaN;
  }

  const gains = [];
  const losses = [];

  for (
    let i = 1;
    i < values.length;
    i++
  ) {
    const change =
      Number(values[i]) -
      Number(values[i - 1]);

    gains.push(
      Math.max(change, 0)
    );

    losses.push(
      Math.max(-change, 0)
    );
  }

  const avgGains =
    rmaSeries(gains, period);

  const avgLosses =
    rmaSeries(losses, period);

  const gain =
    last(avgGains);

  const loss =
    last(avgLosses);

  if (
    !Number.isFinite(gain) ||
    !Number.isFinite(loss)
  ) {
    return NaN;
  }

  if (
    gain === 0 &&
    loss === 0
  ) {
    return 50;
  }

  if (loss === 0) {
    return 100;
  }

  const rs =
    gain / loss;

  return (
    100 -
    100 / (1 + rs)
  );
}


function rsiSignal(values) {
  const value =
    calculateRsi(values, 14);

  if (!finite(value)) {
    return wait();
  }

  // Conservative SMRT classification.
  if (value > 55 && value < 75) {
    return bullish(
      value,
      'RSI bullish momentum'
    );
  }

  if (value < 45 && value > 25) {
    return bearish(
      value,
      'RSI bearish momentum'
    );
  }

  return neutral(
    value,
    'RSI neutral or extreme'
  );
}


// ============================================================
// INTERNAL BAR STRENGTH
//
// IBS = (Close - Low) / (High - Low)
// ============================================================

function ibsSignal(candles) {
  const candle =
    candles.at(-1);

  if (!candle) {
    return wait();
  }

  const high =
    num(candle.high);

  const low =
    num(candle.low);

  const close =
    num(candle.close);

  const range =
    high - low;

  if (
    !finite(range) ||
    range === 0
  ) {
    return neutral(
      0,
      'IBS flat candle'
    );
  }

  const value =
    (
      close - low
    ) / range;

  if (value >= 0.6) {
    return bullish(
      value,
      'IBS buying pressure'
    );
  }

  if (value <= 0.4) {
    return bearish(
      value,
      'IBS selling pressure'
    );
  }

  return neutral(
    value,
    'IBS balanced'
  );
}


// ============================================================
// QSTICK
//
// Qstick = SMA(Close - Open, 20)
// ============================================================

function qstickSignal(candles) {
  if (candles.length < 20) {
    return wait();
  }

  const values =
    candles.map(
      candle =>
        num(candle.close) -
        num(candle.open)
    );

  const value =
    sma(values, 20);

  if (!finite(value)) {
    return wait();
  }

  if (value > 0) {
    return bullish(
      value,
      'Qstick buying pressure'
    );
  }

  if (value < 0) {
    return bearish(
      value,
      'Qstick selling pressure'
    );
  }

  return neutral(
    value,
    'Qstick balanced'
  );
}


// ============================================================
// AWESOME OSCILLATOR
//
// Median = (High + Low) / 2
// AO = SMA(5) - SMA(34)
// ============================================================

function awesomeOscillatorSignal(candles) {
  if (candles.length < 34) {
    return wait();
  }

  const median =
    candles.map(
      candle =>
        (
          num(candle.high) +
          num(candle.low)
        ) / 2
    );

  const fast =
    sma(median, 5);

  const slow =
    sma(median, 34);

  if (
    !finite(fast) ||
    !finite(slow)
  ) {
    return wait();
  }

  const value =
    fast - slow;

  if (value > 0) {
    return bullish(
      value,
      'Awesome Oscillator above zero'
    );
  }

  if (value < 0) {
    return bearish(
      value,
      'Awesome Oscillator below zero'
    );
  }

  return neutral(
    value,
    'Awesome Oscillator neutral'
  );
}


// ============================================================
// COPPOCK CURVE
//
// ROC(14) + ROC(11), then WMA(10)
// ============================================================

function coppockSignal(values) {
  if (values.length < 25) {
    return wait();
  }

  const roc14 =
    rocSeries(values, 14);

  const roc11 =
    rocSeries(values, 11);

  const combined =
    values.map(
      (_, index) => {
        const a =
          roc14[index];

        const b =
          roc11[index];

        return (
          finite(a) &&
          finite(b)
        )
          ? a + b
          : NaN;
      }
    );

  const usable =
    combined.filter(finite);

  const value =
    wma(usable, 10);

  if (!finite(value)) {
    return wait();
  }

  if (value > 0) {
    return bullish(
      value,
      'Coppock Curve above zero'
    );
  }

  if (value < 0) {
    return bearish(
      value,
      'Coppock Curve below zero'
    );
  }

  return neutral(
    value,
    'Coppock Curve neutral'
  );
}
// ============================================================
// PPO - PERCENTAGE PRICE OSCILLATOR
//
// Default: 12 / 26 / 9
// PPO = ((EMA12 - EMA26) / EMA26) * 100
// ============================================================

function ppoSignal(values) {
  if (values.length < 35) {
    return wait();
  }

  const fast =
    emaSeries(values, 12);

  const slow =
    emaSeries(values, 26);

  const ppo =
    values.map((_, index) => {
      const a = fast[index];
      const b = slow[index];

      if (
        !finite(a) ||
        !finite(b) ||
        Number(b) === 0
      ) {
        return NaN;
      }

      return (
        (
          Number(a) -
          Number(b)
        ) /
        Number(b)
      ) * 100;
    });

  const usable =
    ppo.filter(finite);

  if (usable.length < 9) {
    return wait();
  }

  const signalSeries =
    emaSeries(usable, 9);

  const value =
    last(usable);

  const signal =
    last(signalSeries);

  if (
    !finite(value) ||
    !finite(signal)
  ) {
    return wait();
  }

  const histogram =
    Number(value) -
    Number(signal);

  if (
    value > signal &&
    histogram > 0
  ) {
    return bullish(
      value,
      'PPO above signal'
    );
  }

  if (
    value < signal &&
    histogram < 0
  ) {
    return bearish(
      value,
      'PPO below signal'
    );
  }

  return neutral(
    value,
    'PPO neutral'
  );
}


// ============================================================
// PVO - PERCENTAGE VOLUME OSCILLATOR
//
// Default: 12 / 26 / 9
//
// Missing/invalid volume MUST NOT create a signal.
// ============================================================

function pvoSignal(candles) {
  if (candles.length < 35) {
    return wait();
  }

  const volume =
    volumes(candles);

  if (
    !volume.every(finite) ||
    volume.every(value => Number(value) <= 0)
  ) {
    return wait(
      null,
      'Volume unavailable'
    );
  }

  const fast =
    emaSeries(volume, 12);

  const slow =
    emaSeries(volume, 26);

  const pvo =
    volume.map((_, index) => {
      const a = fast[index];
      const b = slow[index];

      if (
        !finite(a) ||
        !finite(b) ||
        Number(b) === 0
      ) {
        return NaN;
      }

      return (
        (
          Number(a) -
          Number(b)
        ) /
        Number(b)
      ) * 100;
    });

  const usable =
    pvo.filter(finite);

  if (usable.length < 9) {
    return wait();
  }

  const signalSeries =
    emaSeries(usable, 9);

  const value =
    last(usable);

  const signal =
    last(signalSeries);

  if (
    !finite(value) ||
    !finite(signal)
  ) {
    return wait();
  }

  /*
   * PVO measures volume momentum, not price direction.
   * Therefore PVO alone is NOT allowed to manufacture
   * bullish/bearish trade direction.
   *
   * Direction will be supplied by price-pressure members
   * of the Pressure / Volume composite.
   */

  return neutral(
    value,
    value > signal
      ? 'Volume momentum expanding'
      : 'Volume momentum contracting'
  );
}


// ============================================================
// STOCHASTIC OSCILLATOR
//
// %K = (Close - LowestLow) /
//      (HighestHigh - LowestLow) * 100
//
// Default lookback: 14
// %D smoothing: 3
// ============================================================

function stochasticSignal(candles) {
  if (candles.length < 16) {
    return wait();
  }

  const kSeries =
    new Array(candles.length).fill(NaN);

  for (
    let i = 13;
    i < candles.length;
    i++
  ) {
    const window =
      candles.slice(
        i - 13,
        i + 1
      );

    const windowHigh =
      Math.max(
        ...window.map(
          candle => num(candle.high)
        )
      );

    const windowLow =
      Math.min(
        ...window.map(
          candle => num(candle.low)
        )
      );

    const close =
      num(candles[i].close);

    const range =
      windowHigh -
      windowLow;

    kSeries[i] =
      range === 0
        ? 50
        : (
            (
              close -
              windowLow
            ) /
            range
          ) * 100;
  }

  const kValues =
    kSeries.filter(finite);

  if (kValues.length < 3) {
    return wait();
  }

  const k =
    last(kValues);

  const d =
    sma(kValues, 3);

  if (
    !finite(k) ||
    !finite(d)
  ) {
    return wait();
  }

  if (
    k > d &&
    k > 50 &&
    k < 80
  ) {
    return bullish(
      k,
      'Stochastic bullish'
    );
  }

  if (
    k < d &&
    k < 50 &&
    k > 20
  ) {
    return bearish(
      k,
      'Stochastic bearish'
    );
  }

  return neutral(
    k,
    'Stochastic neutral/extreme'
  );
}


// ============================================================
// RSI SERIES HELPER
// Used by Stochastic RSI and Connors RSI.
// ============================================================

function rsiSeries(values, period = 14) {
  const result =
    new Array(values.length).fill(NaN);

  if (
    !Array.isArray(values) ||
    values.length <= period
  ) {
    return result;
  }

  for (
    let i = period;
    i < values.length;
    i++
  ) {
    const subset =
      values.slice(
        0,
        i + 1
      );

    result[i] =
      calculateRsi(
        subset,
        period
      );
  }

  return result;
}


// ============================================================
// STOCHASTIC RSI
//
// StochRSI =
// (RSI - Lowest RSI) /
// (Highest RSI - Lowest RSI)
// ============================================================

function stochasticRsiSignal(values) {
  const period = 14;

  if (values.length < 29) {
    return wait();
  }

  const rsiValues =
    rsiSeries(
      values,
      period
    ).filter(finite);

  if (rsiValues.length < period) {
    return wait();
  }

  const window =
    rsiValues.slice(-period);

  const current =
    last(window);

  const minimum =
    Math.min(...window);

  const maximum =
    Math.max(...window);

  const range =
    maximum -
    minimum;

  const value =
    range === 0
      ? 0.5
      : (
          current -
          minimum
        ) / range;

  if (value > 0.55 && value < 0.8) {
    return bullish(
      value,
      'Stochastic RSI bullish'
    );
  }

  if (value < 0.45 && value > 0.2) {
    return bearish(
      value,
      'Stochastic RSI bearish'
    );
  }

  return neutral(
    value,
    'Stochastic RSI neutral/extreme'
  );
}


// ============================================================
// WILLIAMS %R
//
// Default: 14
//
// %R =
// (HighestHigh - Close) /
// (HighestHigh - LowestLow) * -100
// ============================================================

function williamsRSignal(candles) {
  if (candles.length < 14) {
    return wait();
  }

  const h =
    highs(candles);

  const l =
    lows(candles);

  const c =
    last(closes(candles));

  const hh =
    highest(h, 14);

  const ll =
    lowest(l, 14);

  const range =
    hh - ll;

  if (
    !finite(c) ||
    !finite(hh) ||
    !finite(ll) ||
    range === 0
  ) {
    return wait();
  }

  const value =
    (
      (
        hh - c
      ) /
      range
    ) * -100;

  /*
   * Williams %R is used here as a reversal/exhaustion
   * component, not a standalone trend signal.
   */

  if (value <= -80) {
    return bullish(
      value,
      'Williams %R oversold'
    );
  }

  if (value >= -20) {
    return bearish(
      value,
      'Williams %R overbought'
    );
  }

  return neutral(
    value,
    'Williams %R neutral'
  );
}


// ============================================================
// ULTIMATE OSCILLATOR
//
// Default periods: 7 / 14 / 28
// ============================================================

function ultimateOscillatorSignal(candles) {
  if (candles.length < 29) {
    return wait();
  }

  const bp = [];
  const tr = [];

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {
    const close =
      num(candles[i].close);

    const low =
      num(candles[i].low);

    const high =
      num(candles[i].high);

    const previousClose =
      num(candles[i - 1].close);

    const trueLow =
      Math.min(
        low,
        previousClose
      );

    const trueHigh =
      Math.max(
        high,
        previousClose
      );

    bp.push(
      close -
      trueLow
    );

    tr.push(
      trueHigh -
      trueLow
    );
  }

  const average =
    period => {
      if (
        bp.length < period ||
        tr.length < period
      ) {
        return NaN;
      }

      const bpWindow =
        bp.slice(-period);

      const trWindow =
        tr.slice(-period);

      const bpSum =
        bpWindow.reduce(
          (sum, value) =>
            sum + Number(value),
          0
        );

      const trSum =
        trWindow.reduce(
          (sum, value) =>
            sum + Number(value),
          0
        );

      // Source uses neutral handling for flat TR.
      return trSum === 0
        ? 0.5
        : bpSum / trSum;
    };

  const avg7 =
    average(7);

  const avg14 =
    average(14);

  const avg28 =
    average(28);

  if (
    !finite(avg7) ||
    !finite(avg14) ||
    !finite(avg28)
  ) {
    return wait();
  }

  const value =
    100 *
    (
      4 * avg7 +
      2 * avg14 +
      avg28
    ) /
    7;

  if (
    value > 55 &&
    value < 70
  ) {
    return bullish(
      value,
      'Ultimate Oscillator bullish'
    );
  }

  if (
    value < 45 &&
    value > 30
  ) {
    return bearish(
      value,
      'Ultimate Oscillator bearish'
    );
  }

  return neutral(
    value,
    'Ultimate Oscillator neutral/extreme'
  );
}
// ============================================================
// ICHIMOKU CLOUD
//
// Defaults:
// Conversion / Tenkan = 9
// Base / Kijun       = 26
// Leading Span B     = 52
//
// For the current signal we compare:
// Price vs cloud + Tenkan vs Kijun.
// ============================================================

function ichimokuSignal(candles) {
  if (candles.length < 78) {
    return wait();
  }

  const midpoint = (period, displacement = 0) => {
    const window =
      candles.slice(candles.length-displacement-period, candles.length-displacement);

    const hh =
      Math.max(
        ...window.map(
          candle => num(candle.high)
        )
      );

    const ll =
      Math.min(
        ...window.map(
          candle => num(candle.low)
        )
      );

    return (
      finite(hh) &&
      finite(ll)
    )
      ? (hh + ll) / 2
      : NaN;
  };

  const tenkan =
    midpoint(9);

  const kijun =
    midpoint(26);

  const spanA = (midpoint(9, 26) + midpoint(26, 26)) / 2;
  const spanB = midpoint(52, 26);

  const close =
    num(
      candles.at(-1)?.close
    );

  if (
    !finite(tenkan) ||
    !finite(kijun) ||
    !finite(spanA) ||
    !finite(spanB) ||
    !finite(close)
  ) {
    return wait();
  }

  const cloudTop =
    Math.max(
      spanA,
      spanB
    );

  const cloudBottom =
    Math.min(
      spanA,
      spanB
    );

  if (
    close > cloudTop &&
    tenkan > kijun
  ) {
    return bullish(
      close,
      'Ichimoku bullish cloud structure'
    );
  }

  if (
    close < cloudBottom &&
    tenkan < kijun
  ) {
    return bearish(
      close,
      'Ichimoku bearish cloud structure'
    );
  }

  return neutral(
    close,
    'Ichimoku mixed/cloud'
  );
}


// ============================================================
// RELATIVE VIGOR INDEX - RVI
//
// Default period = 10
// Signal period  = 4
//
// Uses 1-2-2-1 FIR weighting.
// ============================================================

function rviSignal(candles) {
  if (candles.length < 16) {
    return wait();
  }

  const numerator = [];
  const denominator = [];

  for (
    let i = 3;
    i < candles.length;
    i++
  ) {
    const c0 = candles[i];
    const c1 = candles[i - 1];
    const c2 = candles[i - 2];
    const c3 = candles[i - 3];

    const numValue =
      (
        (
          num(c0.close) -
          num(c0.open)
        ) +
        2 * (
          num(c1.close) -
          num(c1.open)
        ) +
        2 * (
          num(c2.close) -
          num(c2.open)
        ) +
        (
          num(c3.close) -
          num(c3.open)
        )
      ) / 6;

    const denValue =
      (
        (
          num(c0.high) -
          num(c0.low)
        ) +
        2 * (
          num(c1.high) -
          num(c1.low)
        ) +
        2 * (
          num(c2.high) -
          num(c2.low)
        ) +
        (
          num(c3.high) -
          num(c3.low)
        )
      ) / 6;

    numerator.push(numValue);
    denominator.push(denValue);
  }

  const numSma =
    smaSeries(
      numerator,
      10
    );

  const denSma =
    smaSeries(
      denominator,
      10
    );

  const rvi = [];

  for (
    let i = 0;
    i < numSma.length;
    i++
  ) {
    if (
      finite(numSma[i]) &&
      finite(denSma[i]) &&
      Number(denSma[i]) !== 0
    ) {
      rvi.push(
        Number(numSma[i]) /
        Number(denSma[i])
      );
    }
  }

  if (rvi.length < 4) {
    return wait();
  }

  const value =
    last(rvi);

  const signal =
    (
      rvi.at(-1) +
      2 * rvi.at(-2) +
      2 * rvi.at(-3) +
      rvi.at(-4)
    ) / 6;

  if (
    !finite(value) ||
    !finite(signal)
  ) {
    return wait();
  }

  if (value > signal) {
    return bullish(
      value,
      'RVI above signal'
    );
  }

  if (value < signal) {
    return bearish(
      value,
      'RVI below signal'
    );
  }

  return neutral(
    value,
    'RVI neutral'
  );
}


// ============================================================
// ELDER-RAY INDEX
//
// Default EMA = 13
//
// Bull Power = High - EMA
// Bear Power = Low  - EMA
// ============================================================

function elderRaySignal(candles) {
  if (candles.length < 13) {
    return wait();
  }

  const closeValues =
    closes(candles);

  const ema =
    emaSeries(
      closeValues,
      13
    );

  const currentEma =
    last(ema);

  const candle =
    candles.at(-1);

  if (
    !finite(currentEma) ||
    !candle
  ) {
    return wait();
  }

  const bullPower =
    num(candle.high) -
    Number(currentEma);

  const bearPower =
    num(candle.low) -
    Number(currentEma);

  if (
    !finite(bullPower) ||
    !finite(bearPower)
  ) {
    return wait();
  }

  const value = {
    bullPower,
    bearPower
  };

  if (
    bullPower > 0 &&
    bearPower >= 0
  ) {
    return bullish(
      value,
      'Elder-Ray bullish pressure'
    );
  }

  if (
    bearPower < 0 &&
    bullPower <= 0
  ) {
    return bearish(
      value,
      'Elder-Ray bearish pressure'
    );
  }

  return neutral(
    value,
    'Elder-Ray mixed pressure'
  );
}


// ============================================================
// CHAIKIN OSCILLATOR
//
// Fast EMA = 3
// Slow EMA = 10
//
// Uses Accumulation / Distribution.
// Invalid volume => WAIT.
// ============================================================

function chaikinSignal(candles) {
  if (candles.length < 10) {
    return wait();
  }

  let ad = 0;
  const adSeries = [];

  let validVolumeCount = 0;

  for (const candle of candles) {
    const high =
      num(candle.high);

    const low =
      num(candle.low);

    const close =
      num(candle.close);

    const volume =
      num(candle.volume);

    if (
      !finite(high) ||
      !finite(low) ||
      !finite(close) ||
      !finite(volume) ||
      volume < 0
    ) {
      adSeries.push(NaN);
      continue;
    }

    if (volume > 0) {
      validVolumeCount++;
    }

    const range =
      high - low;

    const multiplier =
      range === 0
        ? 0
        : (
            (
              close - low
            ) -
            (
              high - close
            )
          ) / range;

    ad +=
      multiplier *
      volume;

    adSeries.push(ad);
  }

  if (validVolumeCount === 0) {
    return wait(
      null,
      'Volume unavailable'
    );
  }

  const fast =
    emaSeries(
      adSeries,
      3
    );

  const slow =
    emaSeries(
      adSeries,
      10
    );

  const fastValue =
    last(fast);

  const slowValue =
    last(slow);

  if (
    !finite(fastValue) ||
    !finite(slowValue)
  ) {
    return wait();
  }

  const value =
    Number(fastValue) -
    Number(slowValue);

  if (value > 0) {
    return bullish(
      value,
      'Chaikin accumulation pressure'
    );
  }

  if (value < 0) {
    return bearish(
      value,
      'Chaikin distribution pressure'
    );
  }

  return neutral(
    value,
    'Chaikin neutral'
  );
}


// ============================================================
// FISHER TRANSFORM
//
// Close-only Fisher implementation.
// Default lookback = 10.
// ============================================================

function fisherSignal(candles) {
  const period = 10;

  if (candles.length < period) {
    return wait();
  }

  const values =
    closes(candles);

  const window =
    values.slice(-period);

  if (!window.every(finite)) {
    return wait();
  }

  const minimum =
    Math.min(...window);

  const maximum =
    Math.max(...window);

  const range =
    maximum -
    minimum;

  if (range === 0) {
    return neutral(
      0,
      'Fisher flat range'
    );
  }

  let x =
    2 *
    (
      (
        Number(last(window)) -
        minimum
      ) /
      range
    ) -
    1;

  x =
    Math.max(
      -0.999,
      Math.min(
        0.999,
        x
      )
    );

  const value =
    0.5 *
    Math.log(
      (1 + x) /
      (1 - x)
    );

  if (!finite(value)) {
    return wait();
  }

  if (value > 0) {
    return bullish(
      value,
      'Fisher positive'
    );
  }

  if (value < 0) {
    return bearish(
      value,
      'Fisher negative'
    );
  }

  return neutral(
    value,
    'Fisher neutral'
  );
}


// ============================================================
// EHLERS FISHER TRANSFORM
//
// Canonical recursive version.
// Default lookback = 10.
// Median price = (High + Low) / 2
// ============================================================

function ehlersFisherSignal(candles) {
  const period = 10;

  if (candles.length < period) {
    return wait();
  }

  const prices =
    candles.map(
      candle =>
        (
          num(candle.high) +
          num(candle.low)
        ) / 2
    );

  if (!prices.every(finite)) {
    return wait();
  }

  let previousValue = 0;
  let previousFisher = 0;
  let currentFisher = NaN;

  for (
    let i = period - 1;
    i < prices.length;
    i++
  ) {
    const window =
      prices.slice(
        i - period + 1,
        i + 1
      );

    const minimum =
      Math.min(...window);

    const maximum =
      Math.max(...window);

    const range =
      maximum -
      minimum;

    let normalized =
      range === 0
        ? 0
        : (
            (
              prices[i] -
              minimum
            ) /
            range
          ) - 0.5;

    let value =
      0.33 *
      2 *
      normalized +
      0.67 *
      previousValue;

    value =
      Math.max(
        -0.999,
        Math.min(
          0.999,
          value
        )
      );

    currentFisher =
      0.5 *
      Math.log(
        (1 + value) /
        (1 - value)
      ) *
      0.5 +
      0.5 *
      previousFisher;

    previousValue =
      value;

    previousFisher =
      currentFisher;
  }

  if (!finite(currentFisher)) {
    return wait();
  }

  if (currentFisher > 0) {
    return bullish(
      currentFisher,
      'Ehlers Fisher positive'
    );
  }

  if (currentFisher < 0) {
    return bearish(
      currentFisher,
      'Ehlers Fisher negative'
    );
  }

  return neutral(
    currentFisher,
    'Ehlers Fisher neutral'
  );
}
// ============================================================
// CONNORS RSI
//
// Defaults:
// Price RSI       = 3
// Streak RSI      = 2
// Percent Rank    = 100
//
// CRSI =
// (RSI(3) + RSI(Streak,2) + PercentRank(ROC,100)) / 3
// ============================================================

function connorsRsiSignal(values) {
  const pricePeriod = 3;
  const streakPeriod = 2;
  const rankPeriod = 100;

  if (
    !Array.isArray(values) ||
    values.length < 102
  ) {
    return wait(
      null,
      'Connors RSI warm-up'
    );
  }

  const priceRsi =
    calculateRsi(
      values,
      pricePeriod
    );

  const streaks =
    new Array(values.length).fill(0);

  let streak = 0;

  for (
    let i = 1;
    i < values.length;
    i++
  ) {
    const current =
      Number(values[i]);

    const previous =
      Number(values[i - 1]);

    if (
      !Number.isFinite(current) ||
      !Number.isFinite(previous)
    ) {
      streak = 0;
      streaks[i] = 0;
      continue;
    }

    if (current > previous) {
      streak =
        streak > 0
          ? streak + 1
          : 1;

    } else if (current < previous) {
      streak =
        streak < 0
          ? streak - 1
          : -1;

    } else {
      streak = 0;
    }

    streaks[i] =
      streak;
  }

  const usableStreaks =
    streaks.slice(1);

  const streakRsi =
    calculateRsi(
      usableStreaks,
      streakPeriod
    );

  const roc1 = [];

  for (
    let i = 1;
    i < values.length;
    i++
  ) {
    const previous =
      Number(values[i - 1]);

    const current =
      Number(values[i]);

    if (
      !Number.isFinite(previous) ||
      !Number.isFinite(current) ||
      previous === 0
    ) {
      roc1.push(NaN);
      continue;
    }

    roc1.push(
      (
        (
          current -
          previous
        ) /
        previous
      ) * 100
    );
  }

  const validRoc =
    roc1.filter(finite);

  if (
    validRoc.length <
    rankPeriod
  ) {
    return wait(
      null,
      'Connors RSI percent-rank warm-up'
    );
  }

  const rankWindow =
    validRoc.slice(
      -rankPeriod
    );

  const currentRoc =
    last(rankWindow);

  let below = 0;

  for (
    let i = 0;
    i < rankWindow.length - 1;
    i++
  ) {
    if (
      Number(rankWindow[i]) <
      Number(currentRoc)
    ) {
      below++;
    }
  }

  const percentRank =
    (
      below /
      (rankPeriod - 1)
    ) * 100;

  if (
    !finite(priceRsi) ||
    !finite(streakRsi) ||
    !finite(percentRank)
  ) {
    return wait();
  }

  const value =
    (
      Number(priceRsi) +
      Number(streakRsi) +
      Number(percentRank)
    ) / 3;

  // Reversal interpretation.
  if (value <= 20) {
    return bullish(
      value,
      'Connors RSI oversold'
    );
  }

  if (value >= 80) {
    return bearish(
      value,
      'Connors RSI overbought'
    );
  }

  return neutral(
    value,
    'Connors RSI neutral'
  );
}


// ============================================================
// TD SEQUENTIAL
//
// Defaults from uploaded source:
// Setup lookback     = 4
// Countdown lookback = 2
// Setup              = 9
// Countdown          = 13
// ============================================================

function tdSequentialSignal(values) {
  if (
    !Array.isArray(values) ||
    values.length < 14
  ) {
    return wait(
      null,
      'TD Sequential warm-up'
    );
  }

  const lookback = 4;
  const countdownLookback = 2;
  const setupPeriod = 9;
  const countdownPeriod = 13;

  let buySetup = 0;
  let sellSetup = 0;

  let buyCountdown = 0;
  let sellCountdown = 0;

  let inBuyCountdown = false;
  let inSellCountdown = false;

  let completedBuy = false;
  let completedSell = false;

  for (
    let i = 0;
    i < values.length;
    i++
  ) {
    const current =
      Number(values[i]);

    if (
      !Number.isFinite(current) ||
      i < lookback
    ) {
      continue;
    }

    const previous =
      Number(
        values[
          i - lookback
        ]
      );

    if (!Number.isFinite(previous)) {
      continue;
    }

    // Buy setup:
    // close < close 4 bars ago.
    if (current < previous) {
      if (buySetup < setupPeriod) {
        buySetup =
          buySetup >= 0
            ? buySetup + 1
            : 1;
      }
    } else {
      buySetup = 0;
    }

    // Sell setup:
    // close > close 4 bars ago.
    if (current > previous) {
      if (
        sellSetup >
        -setupPeriod
      ) {
        sellSetup =
          sellSetup <= 0
            ? sellSetup - 1
            : -1;
      }
    } else {
      sellSetup = 0;
    }

    if (
      buySetup >=
      setupPeriod
    ) {
      inBuyCountdown = true;

      inSellCountdown = false;
      sellCountdown = 0;
    }

    if (
      sellSetup <=
      -setupPeriod
    ) {
      inSellCountdown = true;

      inBuyCountdown = false;
      buyCountdown = 0;
    }

    if (
      inBuyCountdown &&
      buyCountdown <
        countdownPeriod &&
      i >= countdownLookback
    ) {
      const compare =
        Number(
          values[
            i -
            countdownLookback
          ]
        );

      if (
        Number.isFinite(compare) &&
        current <= compare
      ) {
        buyCountdown++;
      }
    }

    if (
      inSellCountdown &&
      sellCountdown <
        countdownPeriod &&
      i >= countdownLookback
    ) {
      const compare =
        Number(
          values[
            i -
            countdownLookback
          ]
        );

      if (
        Number.isFinite(compare) &&
        current >= compare
      ) {
        sellCountdown++;
      }
    }

    if (
      buyCountdown >=
      countdownPeriod
    ) {
      completedBuy = true;

      buyCountdown = 0;
      inBuyCountdown = false;
    }

    if (
      sellCountdown >=
      countdownPeriod
    ) {
      completedSell = true;

      sellCountdown = 0;
      inSellCountdown = false;
    }
  }

  const value = {
    buySetup,
    sellSetup,
    buyCountdown,
    sellCountdown,
    completedBuy,
    completedSell
  };

  /*
   * Completed BUY countdown = potential bullish reversal.
   * Completed SELL countdown = potential bearish reversal.
   */

  if (
    completedBuy &&
    !completedSell
  ) {
    return bullish(
      value,
      'TD Sequential buy exhaustion'
    );
  }

  if (
    completedSell &&
    !completedBuy
  ) {
    return bearish(
      value,
      'TD Sequential sell exhaustion'
    );
  }

  if (
    buySetup >= setupPeriod
  ) {
    return bullish(
      value,
      'TD Sequential buy setup'
    );
  }

  if (
    sellSetup <=
    -setupPeriod
  ) {
    return bearish(
      value,
      'TD Sequential sell setup'
    );
  }

  return neutral(
    value,
    'TD Sequential not completed'
  );
}


// ============================================================
// PRING SPECIAL K
//
// Source paths:
//
// ROC10  -> SMA10
// ROC15  -> SMA10
// ROC20  -> SMA10
// ROC30  -> SMA15
// ROC40  -> SMA50
// ROC65  -> SMA65
// ROC75  -> SMA75
// ROC100 -> SMA100
// ROC195 -> SMA130
// ROC265 -> SMA130
// ROC390 -> SMA130
// ROC530 -> SMA195
//
// Requires substantially more history than the normal
// 220-candle Prime warm-up.
//
// Until enough history exists => WAIT.
// ============================================================

function specialKSignal(values) {
  /*
   * Slowest path is ROC530 + SMA195.
   * Keep this fail-closed instead of manufacturing
   * a partial Special K value.
   */
  if (
    !Array.isArray(values) ||
    values.length < 725
  ) {
    return wait(
      null,
      `Special K warm-up ${values?.length || 0}/725`
    );
  }

  const specifications = [
    [10, 10],
    [15, 10],
    [20, 10],
    [30, 15],
    [40, 50],
    [65, 65],
    [75, 75],
    [100, 100],
    [195, 130],
    [265, 130],
    [390, 130],
    [530, 195]
  ];

  const components = [];

  for (
    const [
      rocPeriod,
      smaPeriod
    ] of specifications
  ) {
    const roc =
      rocSeries(
        values,
        rocPeriod
      );

    const usable =
      roc.filter(finite);

    if (
      usable.length <
      smaPeriod
    ) {
      return wait(
        null,
        'Special K component not ready'
      );
    }

    const smoothed =
      sma(
        usable,
        smaPeriod
      );

    if (!finite(smoothed)) {
      return wait(
        null,
        'Special K calculation unavailable'
      );
    }

    components.push(
      Number(smoothed)
    );
  }

  /*
   * Do not invent the source's weighted Special K
   * coefficients here.
   *
   * Until the exact source weights are applied,
   * keep Special K non-directional.
   */

  return neutral(
    {
      components
    },
    'Special K components ready; weighted source output pending'
  );
}
// ============================================================
// SMRT ADVANCED INDICATOR SUITE
//
// Runs all 20 advanced indicators.
//
// IMPORTANT:
// - Calculations use CLOSED candle data supplied by app.js.
// - Missing/invalid indicators remain WAIT.
// - WAIT has side = 0.
// - No automatic order placement.
// ============================================================

export function analyseAdvancedIndicators(
  inputCandles = []
) {
  const candles =
    validCandles(inputCandles);

  if (candles.length === 0) {
    return {
      ready: false,
      candleCount: 0,

      ibs: wait(),
      ichimoku: wait(),
      ppo: wait(),
      specialK: wait(),
      pvo: wait(),
      qstick: wait(),
      rsi: wait(),
      rvi: wait(),
      stochastic: wait(),
      stochasticRsi: wait(),
      tdSequential: wait(),
      ultimateOscillator: wait(),
      williamsR: wait(),
      awesomeOscillator: wait(),
      chaikin: wait(),
      connorsRsi: wait(),
      coppock: wait(),
      ehlersFisher: wait(),
      elderRay: wait(),
      fisher: wait()
    };
  }

  const closeValues =
    closes(candles);

  // ==========================================================
  // RUN ALL 20 INDICATORS
  // ==========================================================

  const result = {
    ibs:
      ibsSignal(candles),

    ichimoku:
      ichimokuSignal(candles),

    ppo:
      ppoSignal(closeValues),

    specialK:
      specialKSignal(closeValues),

    pvo:
      pvoSignal(candles),

    qstick:
      qstickSignal(candles),

    rsi:
      rsiSignal(closeValues),

    rvi:
      rviSignal(candles),

    stochastic:
      stochasticSignal(candles),

    stochasticRsi:
      stochasticRsiSignal(
        closeValues
      ),

    tdSequential:
      tdSequentialSignal(
        closeValues
      ),

    ultimateOscillator:
      ultimateOscillatorSignal(
        candles
      ),

    williamsR:
      williamsRSignal(
        candles
      ),

    awesomeOscillator:
      awesomeOscillatorSignal(
        candles
      ),

    chaikin:
      chaikinSignal(
        candles
      ),

    connorsRsi:
      connorsRsiSignal(
        closeValues
      ),

    coppock:
      coppockSignal(
        closeValues
      ),

    ehlersFisher:
      ehlersFisherSignal(
        candles
      ),

    elderRay:
      elderRaySignal(
        candles
      ),

    fisher:
      fisherSignal(
        candles
      )
  };


  // ==========================================================
  // AUDIT COUNTS
  // ==========================================================

  const indicators =
    Object.values(result);

  const bullishCount =
    indicators.filter(
      indicator =>
        Number(indicator?.side) === 1
    ).length;

  const bearishCount =
    indicators.filter(
      indicator =>
        Number(indicator?.side) === -1
    ).length;

  const waitingCount =
    indicators.filter(
      indicator =>
        Number(indicator?.side) !== 1 &&
        Number(indicator?.side) !== -1
    ).length;

  const activeCount =
    bullishCount +
    bearishCount;


  // ==========================================================
  // RETURN
  // ==========================================================

  return {
    ready:
      activeCount > 0,

    candleCount:
      candles.length,

    bullishCount,
    bearishCount,
    waitingCount,
    activeCount,

    ...result
  };
}
