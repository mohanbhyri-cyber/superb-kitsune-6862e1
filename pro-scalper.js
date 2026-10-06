import { indicators } from './market.js';

/*
  PRO SCALPER - LIVE MARKET VERSION

  Uses:
  - Closed candles only
  - EMA 9 / EMA 21
  - RSI 14
  - Wilder ATR 14 with a complete seed before use
  - VWAP only when genuine volume is available
  - No simulated/fake volume
  - No fake signals
*/

const finite = value =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isFinite(Number(value));

export function proScalper(
  candles,
  {
    closedCount = Math.max(0, (candles?.length || 0) - 1)
  } = {}
) {
  if (!Array.isArray(candles)) {
    return [];
  }

  if (
    !Number.isInteger(closedCount) ||
    closedCount < 0 ||
    closedCount > candles.length
  ) {
    throw Error('Invalid closed candle count');
  }

  if (!candles.length) {
    return [];
  }

  const calc = indicators(candles);
  const result = Array(candles.length).fill(null);

  // NIFTY index candles can have zero/unavailable volume.
  // Never fabricate volume or VWAP.
  const hasRealVolume = candles
    .slice(0, closedCount)
    .some(c => finite(c?.volume) && Number(c.volume) > 0);

  const atrPeriod = 14;
  let atr = null;
  let atrSeed = 0;
  let atrSeedCount = 0;
  let previousDirection = 0;

  for (let i = 0; i < closedCount; i++) {
    const c = candles[i];

    if (
      !c ||
      ![c.open, c.high, c.low, c.close].every(finite)
    ) {
      continue;
    }

    const open = Number(c.open);
    const high = Number(c.high);
    const low = Number(c.low);
    const close = Number(c.close);

    if (high < low) {
      continue;
    }

    const previousClose =
      i > 0 && finite(candles[i - 1]?.close)
        ? Number(candles[i - 1].close)
        : close;

    const tr = Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose)
    );

    // Wilder ATR: do not expose or use ATR until 14 valid TR values
    // have completed the seed. Afterwards use Wilder smoothing.
    if (atr === null) {
      atrSeed += tr;
      atrSeedCount += 1;

      if (atrSeedCount === atrPeriod) {
        atr = atrSeed / atrPeriod;
      }
    } else {
      atr = ((atr * (atrPeriod - 1)) + tr) / atrPeriod;
    }

    // EMA21 and RSI14 need warm-up. ATR must also be ready before
    // any signal, stop or target can be produced.
    if (i < 21 || !finite(atr) || Number(atr) <= 0) {
      continue;
    }

    const e9 = calc.e9?.[i];
    const e21 = calc.e21?.[i];
    const rsi = calc.rsi?.[i];
    const vwap = calc.vwap?.[i];

    if (![e9, e21, rsi].every(finite)) {
      continue;
    }

    const emaDirection =
      Number(e9) > Number(e21)
        ? 1
        : Number(e9) < Number(e21)
          ? -1
          : 0;

    const vwapAvailable =
      hasRealVolume &&
      finite(vwap) &&
      Number(vwap) > 0;

    const vwapDirection =
      !vwapAvailable
        ? 0
        : close > Number(vwap)
          ? 1
          : close < Number(vwap)
            ? -1
            : 0;

    const rsiValue = Number(rsi);

    const long =
      emaDirection === 1 &&
      rsiValue >= 52 &&
      rsiValue <= 70 &&
      (!vwapAvailable || vwapDirection === 1);

    const short =
      emaDirection === -1 &&
      rsiValue >= 30 &&
      rsiValue <= 48 &&
      (!vwapAvailable || vwapDirection === -1);

    const direction = long ? 1 : short ? -1 : 0;

    // Emit BUY/SELL only on a newly aligned closed-candle state.
    const signal =
      direction !== 0 && direction !== previousDirection
        ? direction === 1
          ? 'Buy'
          : 'Sell'
        : null;

    const risk = Number(atr) * 1.5;

    result[i] = {
      time: c.time,
      signal,
      direction,
      atr: Number(atr),
      rsi: rsiValue,
      ema: emaDirection,
      vwap: vwapDirection,
      vwapAvailable,
      entry: close,
      stop: signal ? close - direction * risk : null,
      target: signal ? close + direction * risk * 2 : null
    };

    previousDirection = direction;
  }

  return result;
}
