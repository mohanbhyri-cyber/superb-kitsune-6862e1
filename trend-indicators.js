// Client-side Supertrend (10, 3) and Wilder ADX/DMI (14).
export function trendIndicators(candles, atrPeriod = 10, multiplier = 3, dmiPeriod = 14) {
  const n = candles.length;
  const supertrend = Array(n).fill(null);
  const direction = Array(n).fill(0);
  const plusDI = Array(n).fill(null);
  const minusDI = Array(n).fill(null);
  const adx = Array(n).fill(null);
  let atrSum = 0, atr = null, upper = null, lower = null;
  let trSum = 0, plusSum = 0, minusSum = 0;
  let smoothTR = null, smoothPlus = null, smoothMinus = null;
  let dxSum = 0, lastADX = null;

  for (let i = 1; i < n; i++) {
    const c = candles[i], p = candles[i - 1];
    const high = Number(c.high), low = Number(c.low), close = Number(c.close);
    const prevHigh = Number(p.high), prevLow = Number(p.low), prevClose = Number(p.close);
    if (![high, low, close, prevHigh, prevLow, prevClose].every(Number.isFinite)) continue;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    const up = high - prevHigh, down = prevLow - low;
    const plus = up > down && up > 0 ? up : 0;
    const minus = down > up && down > 0 ? down : 0;

    if (i <= atrPeriod) atrSum += tr;
    if (i === atrPeriod) atr = atrSum / atrPeriod;
    else if (i > atrPeriod && atr !== null) atr = (atr * (atrPeriod - 1) + tr) / atrPeriod;
    if (atr !== null) {
      const mid = (high + low) / 2;
      const basicUpper = mid + multiplier * atr;
      const basicLower = mid - multiplier * atr;
      const oldUpper = upper, oldLower = lower;
      upper = oldUpper === null || basicUpper < oldUpper || prevClose > oldUpper
        ? basicUpper : oldUpper;
      lower = oldLower === null || basicLower > oldLower || prevClose < oldLower
        ? basicLower : oldLower;
      if (i === atrPeriod) direction[i] = close >= mid ? 1 : -1;
      else if (direction[i - 1] === 1) direction[i] = close < oldLower ? -1 : 1;
      else direction[i] = close > oldUpper ? 1 : -1;
      supertrend[i] = direction[i] === 1 ? lower : upper;
    }

    if (i <= dmiPeriod) {
      trSum += tr; plusSum += plus; minusSum += minus;
      if (i === dmiPeriod) {
        smoothTR = trSum; smoothPlus = plusSum; smoothMinus = minusSum;
      }
    } else {
      smoothTR = smoothTR - smoothTR / dmiPeriod + tr;
      smoothPlus = smoothPlus - smoothPlus / dmiPeriod + plus;
      smoothMinus = smoothMinus - smoothMinus / dmiPeriod + minus;
    }
    if (smoothTR === null) continue;
    plusDI[i] = smoothTR > 0 ? 100 * smoothPlus / smoothTR : 0;
    minusDI[i] = smoothTR > 0 ? 100 * smoothMinus / smoothTR : 0;
    const total = plusDI[i] + minusDI[i];
    const dx = total > 0 ? 100 * Math.abs(plusDI[i] - minusDI[i]) / total : 0;
    if (i < 2 * dmiPeriod - 1) dxSum += dx;
    else if (i === 2 * dmiPeriod - 1) {
      lastADX = (dxSum + dx) / dmiPeriod;
      adx[i] = lastADX;
    } else {
      lastADX = (lastADX * (dmiPeriod - 1) + dx) / dmiPeriod;
      adx[i] = lastADX;
    }
  }
  return { supertrend, direction, plusDI, minusDI, adx };
}
