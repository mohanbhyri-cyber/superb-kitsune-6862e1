import { indicators } from './market.js';

/*
  PRO SCALPER - LIVE MARKET VERSION

  Uses:
  - Closed candles only
  - EMA 9 / EMA 21
  - RSI 14
  - ATR 14
  - VWAP only when genuine volume is available
  - No simulated/fake volume
  - No fake signals
*/

export function proScalper(
  candles,
  {
    closedCount = Math.max(
      0,
      candles.length - 1
    )
  } = {}
) {

  if (
    !Number.isInteger(closedCount) ||
    closedCount < 0 ||
    closedCount > candles.length
  ) {
    throw Error(
      'Invalid closed candle count'
    );
  }

  if (!candles.length) {
    return [];
  }

  const calc =
    indicators(candles);

  const result =
    Array(candles.length).fill(null);

  /*
    Detect whether this candle series has
    genuine usable volume.

    NIFTY index candles can return volume 0.
    In that case VWAP must NOT be fabricated.
  */

  const hasRealVolume =
    candles.some(
      c =>
        Number.isFinite(
          Number(c.volume)
        ) &&
        Number(c.volume) > 0
    );

  let atr = 0;
  let previousDirection = 0;

  for (
    let i = 0;
    i < closedCount;
    i++
  ) {

    const c =
      candles[i];

    if (
      !c ||
      !Number.isFinite(c.open) ||
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.close)
    ) {
      continue;
    }

    const previousClose =
      i > 0
        ? candles[i - 1].close
        : c.close;

    /*
      TRUE RANGE
    */

    const tr =
      Math.max(
        c.high - c.low,
        Math.abs(
          c.high - previousClose
        ),
        Math.abs(
          c.low - previousClose
        )
      );

    /*
      ATR 14 - Wilder style
    */

    if (i < 14) {
      atr += tr / 14;
    } else {
      atr =
        (
          atr * 13 +
          tr
        ) / 14;
    }

    /*
      Require enough closed candles
      for stable EMA / RSI calculations.

      21 candles is sufficient for
      EMA 21 + RSI 14.

      We do NOT need to wait for
      50 candles because EMA 50 is
      not used by this strategy.
    */

    if (i < 21) {
      continue;
    }

    const e9 =
      calc.e9?.[i];

    const e21 =
      calc.e21?.[i];

    const rsi =
      calc.rsi?.[i];

    const vwap =
      calc.vwap?.[i];

    if (
      !Number.isFinite(e9) ||
      !Number.isFinite(e21) ||
      !Number.isFinite(rsi)
    ) {
      continue;
    }

    /*
      EMA DIRECTION
    */

    const emaDirection =
      e9 > e21
        ? 1
        : e9 < e21
          ? -1
          : 0;

    /*
      VWAP CONFIRMATION

      Use VWAP only if genuine volume
      exists AND calculated VWAP is valid.

      Otherwise VWAP is neutral/unavailable.
    */

    let vwapDirection = 0;

    const vwapAvailable =
      hasRealVolume &&
      Number.isFinite(vwap) &&
      vwap > 0;

    if (vwapAvailable) {

      vwapDirection =
        c.close > vwap
          ? 1
          : c.close < vwap
            ? -1
            : 0;
    }

    /*
      BUY CONDITIONS

      With genuine volume:
      EMA bullish
      + price above VWAP
      + RSI 52-70

      Without genuine volume:
      EMA bullish
      + RSI 52-70

      VWAP is NOT replaced with fake data.
    */

    const long =
      emaDirection === 1 &&
      rsi >= 52 &&
      rsi <= 70 &&
      (
        !vwapAvailable ||
        vwapDirection === 1
      );

    /*
      SELL CONDITIONS

      With genuine volume:
      EMA bearish
      + price below VWAP
      + RSI 30-48

      Without genuine volume:
      EMA bearish
      + RSI 30-48
    */

    const short =
      emaDirection === -1 &&
      rsi >= 30 &&
      rsi <= 48 &&
      (
        !vwapAvailable ||
        vwapDirection === -1
      );

    const direction =
      long
        ? 1
        : short
          ? -1
          : 0;

    /*
      Signal only when conditions
      newly align.

      Prevents repeating BUY/SELL
      on every candle.
    */

    const signal =
      direction !== 0 &&
      direction !== previousDirection &&
      atr > 0
        ? direction === 1
          ? 'Buy'
          : 'Sell'
        : null;

    const risk =
      atr * 1.5;

    result[i] = {

      time:
        c.time,

      signal,

      direction,

      atr,

      rsi,

      ema:
        emaDirection,

      /*
        0 means VWAP unavailable
        or price exactly at VWAP.
      */

      vwap:
        vwapDirection,

      vwapAvailable,

      entry:
        c.close,

      stop:
        signal
          ? c.close -
            direction * risk
          : null,

      target:
        signal
          ? c.close +
            direction *
            risk *
            2
          : null
    };

    previousDirection =
      direction;
  }

  return result;
}
