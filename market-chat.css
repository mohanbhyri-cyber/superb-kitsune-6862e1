import { indicators } from './market.js';

const finite = value =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isFinite(Number(value));

export function momentumSignals(candles) {
  const out = Array(candles?.length || 0).fill(null);

  if (!Array.isArray(candles) || candles.length < 55) {
    return out;
  }

  const calc = indicators(candles);

  // Last candle is assumed to be live/forming.
  // Signals are generated only from completed candles.
  const lastClosed = candles.length - 2;

  for (let i = 51; i <= lastClosed; i++) {
    const price = Number(candles[i]?.close);

    const e9 = calc.e9?.[i];
    const e21 = calc.e21?.[i];
    const e50 = calc.e50?.[i];

    const prevE9 = calc.e9?.[i - 1];
    const prevE21 = calc.e21?.[i - 1];

    const rsi = calc.rsi?.[i];
    const prevRsi = calc.rsi?.[i - 1];

    const hist = calc.hist?.[i];
    const prevHist = calc.hist?.[i - 1];

    if (
      ![
        price,
        e9,
        e21,
        e50,
        prevE9,
        prevE21,
        rsi,
        prevRsi,
        hist,
        prevHist
      ].every(finite)
    ) {
      out[i] = {
        time: candles[i]?.time,
        signal: null,
        side: 0,
        strength: 0,
        bullScore: 0,
        bearScore: 0,
        reason: 'Momentum indicators not ready'
      };

      continue;
    }

    let bullScore = 0;
    let bearScore = 0;

    const bullReasons = [];
    const bearReasons = [];

    // ---------------------------------------------------------
    // EMA STRUCTURE
    // ---------------------------------------------------------

    const emaBull =
      e9 > e21 &&
      e21 > e50;

    const emaBear =
      e9 < e21 &&
      e21 < e50;

    if (emaBull) {
      bullScore += 2;
      bullReasons.push('EMA 9 > 21 > 50');
    }

    if (emaBear) {
      bearScore += 2;
      bearReasons.push('EMA 9 < 21 < 50');
    }

    // ---------------------------------------------------------
    // EMA SLOPE
    // ---------------------------------------------------------

    if (
      e9 > prevE9 &&
      e21 >= prevE21
    ) {
      bullScore += 1;
      bullReasons.push('EMA slope rising');
    }

    if (
      e9 < prevE9 &&
      e21 <= prevE21
    ) {
      bearScore += 1;
      bearReasons.push('EMA slope falling');
    }

    // ---------------------------------------------------------
    // PRICE LOCATION
    // ---------------------------------------------------------

    if (price > e9 && price > e21) {
      bullScore += 1;
      bullReasons.push('Price above fast EMAs');
    }

    if (price < e9 && price < e21) {
      bearScore += 1;
      bearReasons.push('Price below fast EMAs');
    }

    // ---------------------------------------------------------
    // RSI
    // ---------------------------------------------------------

    const rsiBull =
      rsi >= 52 &&
      rsi <= 68;

    const rsiBear =
      rsi <= 48 &&
      rsi >= 32;

    if (rsiBull) {
      bullScore += 1;
      bullReasons.push('RSI bullish regime');
    }

    if (rsiBear) {
      bearScore += 1;
      bearReasons.push('RSI bearish regime');
    }

    if (
      prevRsi <= 52 &&
      rsi > 52
    ) {
      bullScore += 1;
      bullReasons.push('RSI bullish transition');
    }

    if (
      prevRsi >= 48 &&
      rsi < 48
    ) {
      bearScore += 1;
      bearReasons.push('RSI bearish transition');
    }

    // ---------------------------------------------------------
    // MACD HISTOGRAM
    // ---------------------------------------------------------

    const macdBull = hist > 0;
    const macdBear = hist < 0;

    if (macdBull) {
      bullScore += 1;
      bullReasons.push('MACD positive');
    }

    if (macdBear) {
      bearScore += 1;
      bearReasons.push('MACD negative');
    }

    if (
      hist > 0 &&
      hist > prevHist
    ) {
      bullScore += 1;
      bullReasons.push('MACD momentum increasing');
    }

    if (
      hist < 0 &&
      hist < prevHist
    ) {
      bearScore += 1;
      bearReasons.push('MACD downside momentum increasing');
    }

    // ---------------------------------------------------------
    // FINAL MOMENTUM GATE
    // ---------------------------------------------------------

    let signal = null;
    let side = 0;

    const buyEligible =
      emaBull &&
      rsiBull &&
      macdBull &&
      bullScore >= 5 &&
      bearScore <= 1;

    const sellEligible =
      emaBear &&
      rsiBear &&
      macdBear &&
      bearScore >= 5 &&
      bullScore <= 1;

    if (buyEligible) {
      signal = 'Buy';
      side = 1;
    } else if (sellEligible) {
      signal = 'Sell';
      side = -1;
    }

    const strength =
      side === 1
        ? bullScore
        : side === -1
          ? bearScore
          : Math.max(bullScore, bearScore);

    out[i] = {
      time: candles[i]?.time,

      signal,
      side,
      strength,

      bullScore,
      bearScore,

      price,

      ema9: Number(e9),
      ema21: Number(e21),
      ema50: Number(e50),

      rsi: Number(rsi),
      macdHistogram: Number(hist),

      confirmations:
        side === 1
          ? bullReasons
          : side === -1
            ? bearReasons
            : [],

      reason:
        side === 0
          ? 'Momentum conditions not fully aligned'
          : side === 1
            ? 'Bullish momentum confirmed'
            : 'Bearish momentum confirmed'
    };
  }

  return out;
}
