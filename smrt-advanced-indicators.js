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
  Number.isFinite(Number(value));

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

const validCandles = candles =>
  Array.isArray(candles)
    ? candles.filter(c =>
        finite(c?.open) &&
        finite(c?.high) &&
        finite(c?.low) &&
        finite(c?.close)
      )
    : [];

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
