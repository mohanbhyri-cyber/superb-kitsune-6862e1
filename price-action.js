/** Transparent, original price-action heuristics, evaluated on closed candles. */
export function priceAction(candles, { swing = 3, closedCount = Math.max(0, candles.length - 1) } = {}) {
  if (!Number.isInteger(swing) || swing < 1 || swing > 20 || !Number.isInteger(closedCount) || closedCount < 0 || closedCount > candles.length) throw Error('Invalid price-action settings');
  const pivots = [], breaks = [], zones = [];
  let high = null, low = null, previousHigh = null, previousLow = null, trend = 0;
  for (let i = 0; i < closedCount; i++) {
    const c = candles[i];
    for (const z of zones) {
      if (z.endedAt != null) continue;
      const ended = z.kind === 'FVG' ? (z.direction === 1 ? c.low <= z.low : c.high >= z.high) : (z.direction === 1 ? c.close < z.low : c.close > z.high);
      if (ended) z.endedAt = i;
    }
    if (i >= swing * 2) {
      const p = i - swing, candidate = candles[p], window = candles.slice(p - swing, p + swing + 1);
      if (window.every((b,j) => j === swing || candidate.high > b.high)) {
        high = { index:p, confirmedAt:i, price:candidate.high, type:previousHigh == null?'SH':candidate.high>previousHigh?'HH':'LH', broken:false };
        previousHigh = candidate.high; pivots.push(high);
      }
      if (window.every((b,j) => j === swing || candidate.low < b.low)) {
        low = { index:p, confirmedAt:i, price:candidate.low, type:previousLow == null?'SL':candidate.low>previousLow?'HL':'LL', broken:false };
        previousLow = candidate.low; pivots.push(low);
      }
    }
    const direction = high && !high.broken && c.close > high.price ? 1 : low && !low.broken && c.close < low.price ? -1 : 0;
    if (direction) {
      const pivot = direction === 1 ? high : low;
      breaks.push({ index:i, from:pivot.confirmedAt, price:pivot.price, direction, type:trend && trend !== direction?'CHoCH':'BOS' });
      pivot.broken = true; trend = direction;
      // Last opposing candle before the break; full wick range, invalidated by a close through its far edge.
      for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
        const b = candles[j];
        if (direction === 1 ? b.close < b.open : b.close > b.open) {
          if (direction === 1 ? c.close >= b.low : c.close <= b.high) zones.push({kind:'OB',index:i,origin:j,low:b.low,high:b.high,direction,endedAt:null});
          break;
        }
      }
    }
    if (i >= 2) {
      const first = candles[i-2];
      if (c.low > first.high) zones.push({kind:'FVG',index:i,origin:i-2,low:first.high,high:c.low,direction:1,endedAt:null});
      else if (c.high < first.low) zones.push({kind:'FVG',index:i,origin:i-2,low:c.high,high:first.low,direction:-1,endedAt:null});
    }
  }
  return {pivots,breaks,zones,trend};
}
