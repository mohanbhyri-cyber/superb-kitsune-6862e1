// trend-indicators.js
// ============================================================
// NIFTY 50 TREND ENGINE
// Supertrend + Wilder ATR + DMI / ADX
//
// DESIGN:
// - Closed-candle compatible.
// - Missing OHLC never becomes zero.
// - Safer Supertrend initialization.
// - Wilder smoothing for ATR / DMI / ADX.
// - Exposes ATR and DX for other engines.
// - No BUY / SELL generation here.
// ============================================================

const finite = value =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isFinite(Number(value));

export function trendIndicators(
  candles,
  atrPeriod = 10,
  multiplier = 3,
  dmiPeriod = 14
) {
  const n = Array.isArray(candles)
    ? candles.length
    : 0;

  const supertrend = Array(n).fill(null);
  const direction = Array(n).fill(0);

  const atr = Array(n).fill(null);

  const plusDI = Array(n).fill(null);
  const minusDI = Array(n).fill(null);

  const dx = Array(n).fill(null);
  const adx = Array(n).fill(null);

  if (
    n < 2 ||
    atrPeriod < 1 ||
    dmiPeriod < 1 ||
    !finite(multiplier) ||
    Number(multiplier) <= 0
  ) {
    return {
      supertrend,
      direction,
      atr,
      plusDI,
      minusDI,
      dx,
      adx
    };
  }

  // ==========================================================
  // TRUE RANGE / DIRECTIONAL MOVEMENT
  // ==========================================================

  const tr = Array(n).fill(null);
  const plusDM = Array(n).fill(null);
  const minusDM = Array(n).fill(null);

  for (let i = 1; i < n; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    if (
      ![
        current?.high,
        current?.low,
        current?.close,
        previous?.high,
        previous?.low,
        previous?.close
      ].every(finite)
    ) {
      continue;
    }

    const high = Number(current.high);
    const low = Number(current.low);

    const prevHigh = Number(previous.high);
    const prevLow = Number(previous.low);
    const prevClose = Number(previous.close);

    if (
      high < low ||
      prevHigh < prevLow
    ) {
      continue;
    }

    tr[i] = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );

    const upMove =
      high - prevHigh;

    const downMove =
      prevLow - low;

    plusDM[i] =
      upMove > downMove &&
      upMove > 0
        ? upMove
        : 0;

    minusDM[i] =
      downMove > upMove &&
      downMove > 0
        ? downMove
        : 0;
  }

  // ==========================================================
  // WILDER ATR
  // ==========================================================

  let atrSeed = 0;
  let atrSeedCount = 0;
  let lastATR = null;

  for (let i = 1; i < n; i++) {
    if (!finite(tr[i])) {
      continue;
    }

    if (lastATR === null) {
      atrSeed += Number(tr[i]);
      atrSeedCount += 1;

      if (atrSeedCount === atrPeriod) {
        lastATR =
          atrSeed / atrPeriod;

        atr[i] = lastATR;
      }

      continue;
    }

    lastATR =
      (
        lastATR *
          (atrPeriod - 1) +
        Number(tr[i])
      ) /
      atrPeriod;

    atr[i] = lastATR;
  }

  // ==========================================================
  // SUPERTREND
  // ==========================================================

  const finalUpper =
    Array(n).fill(null);

  const finalLower =
    Array(n).fill(null);

  let previousDirection = 0;

  for (let i = 1; i < n; i++) {
    if (
      !finite(atr[i]) ||
      !finite(candles[i]?.high) ||
      !finite(candles[i]?.low) ||
      !finite(candles[i]?.close) ||
      !finite(candles[i - 1]?.close)
    ) {
      continue;
    }

    const high =
      Number(candles[i].high);

    const low =
      Number(candles[i].low);

    const close =
      Number(candles[i].close);

    const prevClose =
      Number(candles[i - 1].close);

    const midpoint =
      (high + low) / 2;

    const basicUpper =
      midpoint +
      Number(multiplier) *
        Number(atr[i]);

    const basicLower =
      midpoint -
      Number(multiplier) *
        Number(atr[i]);

    const previousUpper =
      finalUpper[i - 1];

    const previousLower =
      finalLower[i - 1];

    // First valid Supertrend candle.
    if (
      !finite(previousUpper) ||
      !finite(previousLower)
    ) {
      finalUpper[i] =
        basicUpper;

      finalLower[i] =
        basicLower;

      previousDirection =
        close >= midpoint
          ? 1
          : -1;

      direction[i] =
        previousDirection;

      supertrend[i] =
        previousDirection === 1
          ? finalLower[i]
          : finalUpper[i];

      continue;
    }

    // Final upper band.
    finalUpper[i] =
      basicUpper <
        Number(previousUpper) ||
      prevClose >
        Number(previousUpper)
        ? basicUpper
        : Number(previousUpper);

    // Final lower band.
    finalLower[i] =
      basicLower >
        Number(previousLower) ||
      prevClose <
        Number(previousLower)
        ? basicLower
        : Number(previousLower);

    const priorDirection =
      direction[i - 1] === 1 ||
      direction[i - 1] === -1
        ? direction[i - 1]
        : previousDirection;

    let currentDirection =
      priorDirection;

    if (
      priorDirection === 1 &&
      close <
        Number(previousLower)
    ) {
      currentDirection = -1;

    } else if (
      priorDirection === -1 &&
      close >
        Number(previousUpper)
    ) {
      currentDirection = 1;
    }

    direction[i] =
      currentDirection;

    previousDirection =
      currentDirection;

    supertrend[i] =
      currentDirection === 1
        ? finalLower[i]
        : finalUpper[i];
  }

  // ==========================================================
  // WILDER DMI
  // ==========================================================

  let trSeed = 0;
  let plusSeed = 0;
  let minusSeed = 0;
  let dmiSeedCount = 0;

  let smoothTR = null;
  let smoothPlus = null;
  let smoothMinus = null;

  for (let i = 1; i < n; i++) {
    if (
      !finite(tr[i]) ||
      !finite(plusDM[i]) ||
      !finite(minusDM[i])
    ) {
      continue;
    }

    if (smoothTR === null) {
      trSeed += Number(tr[i]);
      plusSeed += Number(plusDM[i]);
      minusSeed += Number(minusDM[i]);

      dmiSeedCount += 1;

      if (
        dmiSeedCount === dmiPeriod
      ) {
        smoothTR = trSeed;
        smoothPlus = plusSeed;
        smoothMinus = minusSeed;
      } else {
        continue;
      }

    } else {
      smoothTR =
        smoothTR -
        smoothTR / dmiPeriod +
        Number(tr[i]);

      smoothPlus =
        smoothPlus -
        smoothPlus / dmiPeriod +
        Number(plusDM[i]);

      smoothMinus =
        smoothMinus -
        smoothMinus / dmiPeriod +
        Number(minusDM[i]);
    }

    if (
      !finite(smoothTR) ||
      smoothTR <= 0
    ) {
      plusDI[i] = 0;
      minusDI[i] = 0;
      dx[i] = 0;

      continue;
    }

    plusDI[i] =
      100 *
      Number(smoothPlus) /
      Number(smoothTR);

    minusDI[i] =
      100 *
      Number(smoothMinus) /
      Number(smoothTR);

    const total =
      plusDI[i] +
      minusDI[i];

    dx[i] =
      total > 0
        ? (
            100 *
            Math.abs(
              plusDI[i] -
              minusDI[i]
            )
          ) /
          total
        : 0;
  }

  // ==========================================================
  // WILDER ADX
  // ==========================================================

  let dxSeed = 0;
  let dxSeedCount = 0;
  let lastADX = null;

  for (let i = 0; i < n; i++) {
    if (!finite(dx[i])) {
      continue;
    }

    if (lastADX === null) {
      dxSeed += Number(dx[i]);
      dxSeedCount += 1;

      if (
        dxSeedCount === dmiPeriod
      ) {
        lastADX =
          dxSeed / dmiPeriod;

        adx[i] =
          lastADX;
      }

      continue;
    }

    lastADX =
      (
        lastADX *
          (dmiPeriod - 1) +
        Number(dx[i])
      ) /
      dmiPeriod;

    adx[i] =
      lastADX;
  }

  // ==========================================================
  // SANITY CLEANUP
  // ==========================================================

  for (let i = 0; i < n; i++) {
    if (
      finite(plusDI[i])
    ) {
      plusDI[i] =
        Math.max(
          0,
          Math.min(
            100,
            Number(plusDI[i])
          )
        );
    }

    if (
      finite(minusDI[i])
    ) {
      minusDI[i] =
        Math.max(
          0,
          Math.min(
            100,
            Number(minusDI[i])
          )
        );
    }

    if (finite(dx[i])) {
      dx[i] =
        Math.max(
          0,
          Math.min(
            100,
            Number(dx[i])
          )
        );
    }

    if (finite(adx[i])) {
      adx[i] =
        Math.max(
          0,
          Math.min(
            100,
            Number(adx[i])
          )
        );
    }
  }

  return {
    supertrend,
    direction,

    // Additional outputs used by Prime/Finalizer.
    atr,

    plusDI,
    minusDI,

    dx,
    adx
  };
}
