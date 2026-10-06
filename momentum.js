import { indicators } from './market.js';

const finite = value =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isFinite(Number(value));

/*
  MOMENTUM ENGINE - CLOSED CANDLES ONLY

  Uses:
  - EMA 9 / 21 / 50 structure
  - RSI 14 regime / transition
  - MACD histogram confirmation
  - No live/forming-candle signals
  - No repeated BUY / SELL on every aligned candle
  - No random/demo/fallback signals
*/
export function momentumSignals(candles) {
  const out = Array(candles?.length || 0).fill(null);

  if (!Array.isArray(candles) || candles.length < 55) {
    return out;
  }

  const calc = indicators(candles);

  // The last candle is treated as live/forming.
  // Confirmed signals stop at the prior closed candle.
  const lastClosed = candles.length - 2;
  let previousDirection = 0;

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
        direction: 0,
        strength: 0,
        bullScore: 0,
        bearScore: 0,
        reason: 'Momentum indicators not ready'
      };
      previousDirection = 0;
      continue;
    }

    let bullScore = 0;
    let bearScore = 0;

    const bullReasons = [];
    const bearReasons = [];

    // EMA structure.
    const emaBull = e9 > e21 && e21 > e50;
    const emaBear = e9 < e21 && e21 < e50;

    if (emaBull) {
      bullScore += 2;
      bullReasons.push('EMA 9 > 21 > 50');
    }

    if (emaBear) {
      bearScore += 2;
      bearReasons.push('EMA 9 < 21 < 50');
    }

    // EMA slope.
    if (e9 > prevE9 && e21 >= prevE21) {
      bullScore += 1;
      bullReasons.push('EMA slope rising');
    }

    if (e9 < prevE9 && e21 <= prevE21) {
      bearScore += 1;
      bearReasons.push('EMA slope falling');
    }

    // Price location.
    if (price > e9 && price > e21) {
      bullScore += 1;
      bullReasons.push('Price above fast EMAs');
    }

    if (price < e9 && price < e21) {
      bearScore += 1;
      bearReasons.push('Price below fast EMAs');
    }

    // RSI regime. These are strategy filters, not universal RSI levels.
    const rsiBull = rsi >= 52 && rsi <= 68;
    const rsiBear = rsi <= 48 && rsi >= 32;

    if (rsiBull) {
      bullScore += 1;
      bullReasons.push('RSI bullish regime');
    }

    if (rsiBear) {
      bearScore += 1;
      bearReasons.push('RSI bearish regime');
    }

    if (prevRsi <= 52 && rsi > 52) {
      bullScore += 1;
      bullReasons.push('RSI bullish transition');
    }

    if (prevRsi >= 48 && rsi < 48) {
      bearScore += 1;
      bearReasons.push('RSI bearish transition');
    }

    // MACD histogram.
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

    if (hist > 0 && hist > prevHist) {
      bullScore += 1;
      bullReasons.push('MACD momentum increasing');
    }

    if (hist < 0 && hist < prevHist) {
      bearScore += 1;
      bearReasons.push('MACD downside momentum increasing');
    }

    // Alignment state. BUY/SELL alerts are emitted only on a new
    // transition into an aligned state, preventing repeated signals.
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

    const direction = buyEligible ? 1 : sellEligible ? -1 : 0;

    const signal =
      direction !== 0 && direction !== previousDirection
        ? direction === 1
          ? 'Buy'
          : 'Sell'
        : null;

    const strength =
      direction === 1
        ? bullScore
        : direction === -1
          ? bearScore
          : Math.max(bullScore, bearScore);

    out[i] = {
      time: candles[i]?.time,
      signal,
      side: direction,
      direction,
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
        direction === 1
          ? bullReasons
          : direction === -1
            ? bearReasons
            : [],
      reason:
        direction === 0
          ? 'Momentum conditions not fully aligned'
          : signal
            ? direction === 1
              ? 'New bullish momentum alignment confirmed'
              : 'New bearish momentum alignment confirmed'
            : direction === 1
              ? 'Bullish momentum remains aligned'
              : 'Bearish momentum remains aligned'
    };

    previousDirection = direction;
  }

  return out;
}
