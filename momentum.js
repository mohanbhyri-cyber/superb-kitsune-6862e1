import { indicators } from './market.js';

// ============================================================
// PRO SCALPER — NIFTY 50 MOMENTUM ENGINE
//
// Uses CLOSED candles only.
// No random/demo values.
// BUY/SELL requires multiple confirmations.
// Otherwise signal = null.
// ============================================================

export function momentumSignals(candles) {

  const out = Array(candles.length).fill(null);

  if (!Array.isArray(candles) || candles.length < 55) {
    return out;
  }

  const calc = indicators(candles);

  // Last candle may still be forming.
  // Therefore process only through candles.length - 2.
  const lastClosedIndex = candles.length - 2;

  for (let i = 50; i <= lastClosedIndex; i++) {

    const candle = candles[i];
    const previousCandle = candles[i - 1];

    const price = Number(candle?.close);
    const previousPrice = Number(previousCandle?.close);

    const rsi = Number(calc.rsi?.[i]);
    const previousRsi = Number(calc.rsi?.[i - 1]);

    const ema9 = Number(calc.e9?.[i]);
    const ema21 = Number(calc.e21?.[i]);
    const ema50 = Number(calc.e50?.[i]);

    const previousEma9 = Number(calc.e9?.[i - 1]);
    const previousEma21 = Number(calc.e21?.[i - 1]);

    const macd = Number(calc.macd?.[i]);
    const macdSignal = Number(calc.signal?.[i]);
    const histogram = Number(calc.hist?.[i]);

    const previousHistogram =
      Number(calc.hist?.[i - 1]);

    // --------------------------------------------------------
    // VALIDATION
    // --------------------------------------------------------

    const values = [
      price,
      previousPrice,
      rsi,
      previousRsi,
      ema9,
      ema21,
      ema50,
      previousEma9,
      previousEma21,
      macd,
      macdSignal,
      histogram,
      previousHistogram
    ];

    if (!values.every(Number.isFinite)) {
      continue;
    }

    // --------------------------------------------------------
    // TREND ALIGNMENT
    // --------------------------------------------------------

    const bullishTrend =
      price > ema9 &&
      ema9 > ema21 &&
      ema21 > ema50;

    const bearishTrend =
      price < ema9 &&
      ema9 < ema21 &&
      ema21 < ema50;

    // --------------------------------------------------------
    // EMA MOMENTUM / SLOPE
    // --------------------------------------------------------

    const bullishEmaSlope =
      ema9 > previousEma9 &&
      ema21 >= previousEma21;

    const bearishEmaSlope =
      ema9 < previousEma9 &&
      ema21 <= previousEma21;

    // --------------------------------------------------------
    // RSI MOMENTUM
    //
    // Avoid buying very overbought momentum
    // or selling extremely oversold momentum.
    // --------------------------------------------------------

    const bullishRsi =
      rsi >= 52 &&
      rsi <= 70 &&
      rsi > previousRsi;

    const bearishRsi =
      rsi <= 48 &&
      rsi >= 30 &&
      rsi < previousRsi;

    // Stronger RSI trigger
    const bullishRsiTrigger =
      previousRsi <= 55 &&
      rsi > 55;

    const bearishRsiTrigger =
      previousRsi >= 45 &&
      rsi < 45;

    // --------------------------------------------------------
    // MACD CONFIRMATION
    // --------------------------------------------------------

    const bullishMacd =
      macd > macdSignal &&
      histogram > 0;

    const bearishMacd =
      macd < macdSignal &&
      histogram < 0;

    // Histogram acceleration
    const bullishAcceleration =
      histogram > previousHistogram;

    const bearishAcceleration =
      histogram < previousHistogram;

    // --------------------------------------------------------
    // PRICE MOMENTUM
    // --------------------------------------------------------

    const bullishPrice =
      price > previousPrice;

    const bearishPrice =
      price < previousPrice;

    // --------------------------------------------------------
    // SCORE
    //
    // This is confirmation count, NOT probability.
    // --------------------------------------------------------

    let bullScore = 0;
    let bearScore = 0;

    if (bullishTrend) bullScore++;
    if (bullishEmaSlope) bullScore++;
    if (bullishRsi) bullScore++;
    if (bullishRsiTrigger) bullScore++;
    if (bullishMacd) bullScore++;
    if (bullishAcceleration) bullScore++;
    if (bullishPrice) bullScore++;

    if (bearishTrend) bearScore++;
    if (bearishEmaSlope) bearScore++;
    if (bearishRsi) bearScore++;
    if (bearishRsiTrigger) bearScore++;
    if (bearishMacd) bearScore++;
    if (bearishAcceleration) bearScore++;
    if (bearishPrice) bearScore++;

    // --------------------------------------------------------
    // FINAL MOMENTUM SIGNAL
    //
    // Require:
    // 1. Trend alignment
    // 2. RSI confirmation
    // 3. MACD confirmation
    // 4. Minimum confirmation score
    //
    // Conflicting / weak evidence = no signal.
    // --------------------------------------------------------

    let signal = null;

    if (
      bullishTrend &&
      bullishRsi &&
      bullishMacd &&
      bullScore >= 5 &&
      bearScore <= 1
    ) {
      signal = 'Buy';

    } else if (
      bearishTrend &&
      bearishRsi &&
      bearishMacd &&
      bearScore >= 5 &&
      bullScore <= 1
    ) {
      signal = 'Sell';
    }

    // --------------------------------------------------------
    // MOMENTUM STRENGTH
    // --------------------------------------------------------

    let strength = 'NEUTRAL';

    if (signal === 'Buy') {

      strength =
        bullScore >= 7
          ? 'STRONG BULLISH'
          : bullScore >= 6
            ? 'BULLISH'
            : 'EARLY BULLISH';

    } else if (signal === 'Sell') {

      strength =
        bearScore >= 7
          ? 'STRONG BEARISH'
          : bearScore >= 6
            ? 'BEARISH'
            : 'EARLY BEARISH';
    }

    // --------------------------------------------------------
    // OUTPUT
    // Keep original fields for compatibility with app.js.
    // --------------------------------------------------------

    out[i] = {

      time: candle.time,

      signal,

      strength,

      price,

      rsi,

      ema: ema50,

      ema9,
      ema21,
      ema50,

      macd,
      macdSignal,
      histogram,

      bullScore,
      bearScore,

      confirmations: 7
    };
  }

  return out;
}
