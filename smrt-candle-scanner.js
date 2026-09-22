// smrt-candle-scanner.js
// ============================================================
// SMRT CANDLE SCANNER
// Original closed-candle candlestick scanner for NIFTY 50.
// ============================================================

const finite = v => Number.isFinite(Number(v));

function shape(c) {
  const open = Number(c.open);
  const high = Number(c.high);
  const low = Number(c.low);
  const close = Number(c.close);
  const body = Math.abs(close - open);
  const range = Math.max(0.0001, high - low);
  const upper = high - Math.max(open, close);
  const lower = Math.min(open, close) - low;
  const bull = close > open;
  const bear = close < open;
  return { open, high, low, close, body, range, upper, lower, bull, bear,
    bodyPct: body / range, upperPct: upper / range, lowerPct: lower / range };
}

function near(a, b, tolerance) {
  return Math.abs(a - b) <= tolerance;
}

export function scanCandles(candles) {
  if (!Array.isArray(candles) || candles.length < 5) {
    return { rows: [], latest: null, latestStrong: null };
  }

  const rows = Array(candles.length).fill(null);
  const lastClosed = Math.max(0, candles.length - 2);

  for (let i = 2; i <= lastClosed; i++) {
    const a = shape(candles[i - 2]);
    const b = shape(candles[i - 1]);
    const c = shape(candles[i]);
    const avgRange = [a.range, b.range, c.range].reduce((x, y) => x + y, 0) / 3;
    const tolerance = avgRange * 0.12;
    const patterns = [];

    const push = (name, side = 0, strength = 1) =>
      patterns.push({ name, side, strength });

    // Single-candle patterns
    if (c.bodyPct <= 0.08) push('Doji', 0, 1);
    if (c.bodyPct <= 0.10 && c.lowerPct >= 0.60 && c.upperPct <= 0.15) push('Dragonfly Doji', 1, 2);
    if (c.bodyPct <= 0.10 && c.upperPct >= 0.60 && c.lowerPct <= 0.15) push('Gravestone Doji', -1, 2);
    if (c.bodyPct <= 0.10 && c.upperPct >= 0.35 && c.lowerPct >= 0.35) push('Long-legged Doji', 0, 1);

    if (c.bodyPct <= 0.35 && c.lower >= c.body * 2 && c.upper <= c.body * 0.7) push('Hammer', 1, 2);
    if (c.bodyPct <= 0.35 && c.upper >= c.body * 2 && c.lower <= c.body * 0.7) push('Inverted Hammer', 1, 2);
    if (c.bodyPct <= 0.35 && c.upper >= c.body * 2 && c.lower <= c.body * 0.7) push('Shooting Star', -1, 2);
    if (c.bodyPct <= 0.35 && c.lower >= c.body * 2 && c.upper <= c.body * 0.7) push('Hanging Man', -1, 2);

    if (c.bodyPct >= 0.80 && c.bull) push('Bullish Marubozu', 1, 2);
    if (c.bodyPct >= 0.80 && c.bear) push('Bearish Marubozu', -1, 2);
    if (c.bodyPct <= 0.30 && c.upperPct >= 0.20 && c.lowerPct >= 0.20) push('Spinning Top', 0, 1);

    if (c.lower >= c.body * 2.5 && c.upper <= c.body && c.bull) push('Bullish Pin Bar', 1, 2);
    if (c.upper >= c.body * 2.5 && c.lower <= c.body && c.bear) push('Bearish Pin Bar', -1, 2);

    if (c.lowerPct >= 0.55 && c.close > (c.low + c.range * 0.65)) push('Bullish Rejection', 1, 2);
    if (c.upperPct >= 0.55 && c.close < (c.low + c.range * 0.35)) push('Bearish Rejection', -1, 2);

    // Two-candle patterns
    if (b.bear && c.bull && c.open <= b.close && c.close >= b.open) push('Bullish Engulfing', 1, 3);
    if (b.bull && c.bear && c.open >= b.close && c.close <= b.open) push('Bearish Engulfing', -1, 3);

    if (b.bear && c.bull && c.open < b.close && c.close > (b.open + b.close) / 2 && c.close < b.open)
      push('Piercing Line', 1, 3);

    if (b.bull && c.bear && c.open > b.close && c.close < (b.open + b.close) / 2 && c.close > b.open)
      push('Dark Cloud Cover', -1, 3);

    if (c.high < b.high && c.low > b.low) push('Inside Bar', 0, 1);
    if (c.high > b.high && c.low < b.low) push('Outside Bar', c.bull ? 1 : c.bear ? -1 : 0, 2);

    if (b.bear && c.body < b.body && Math.max(c.open, c.close) < b.open && Math.min(c.open, c.close) > b.close)
      push('Bullish Harami', 1, 2);

    if (b.bull && c.body < b.body && Math.max(c.open, c.close) < b.close && Math.min(c.open, c.close) > b.open)
      push('Bearish Harami', -1, 2);

    if (b.bodyPct > 0.55 && c.bodyPct <= 0.10 && Math.max(c.open, c.close) < Math.max(b.open, b.close) &&
        Math.min(c.open, c.close) > Math.min(b.open, b.close))
      push('Harami Cross', b.bear ? 1 : b.bull ? -1 : 0, 2);

    if (near(b.low, c.low, tolerance) && b.bear && c.bull) push('Tweezer Bottom', 1, 3);
    if (near(b.high, c.high, tolerance) && b.bull && c.bear) push('Tweezer Top', -1, 3);

    // Three-candle patterns
    const aMid = (a.open + a.close) / 2;
    if (a.bear && b.bodyPct <= 0.35 && c.bull && c.close > aMid) push('Morning Star', 1, 4);
    if (a.bull && b.bodyPct <= 0.35 && c.bear && c.close < aMid) push('Evening Star', -1, 4);

    if (a.bull && b.bull && c.bull && b.close > a.close && c.close > b.close &&
        b.open > a.open && c.open > b.open) push('Three White Soldiers', 1, 4);

    if (a.bear && b.bear && c.bear && b.close < a.close && c.close < b.close &&
        b.open < a.open && c.open < b.open) push('Three Black Crows', -1, 4);

    // Breakout candle
    const prior = candles.slice(Math.max(0, i - 8), i);
    const priorHigh = Math.max(...prior.map(x => Number(x.high)));
    const priorLow = Math.min(...prior.map(x => Number(x.low)));

    if (c.close > priorHigh && c.bodyPct >= 0.55) push('Bullish Breakout Candle', 1, 4);
    if (c.close < priorLow && c.bodyPct >= 0.55) push('Bearish Breakdown Candle', -1, 4);

    if (patterns.length) {
      rows[i] = {
        time: candles[i].time,
        patterns: patterns.sort((x, y) => y.strength - x.strength)
      };
    }
  }

  const detected = rows.filter(Boolean);
  const latest = detected.at(-1) || null;
  const latestStrong = detected
    .flatMap(row => row.patterns.map(p => ({ ...p, time: row.time })))
    .filter(p => p.strength >= 3)
    .at(-1) || null;

  return { rows, latest, latestStrong };
}

export function candleConfluence(scanner, marketMap, edge, mtf) {
  const latest = scanner?.latest;
  if (!latest) {
    return { action: 'NO TRADE', score: 0, reason: 'No confirmed candle pattern' };
  }

  const strongest = latest.patterns[0];
  if (!strongest) {
    return { action: 'NO TRADE', score: 0, reason: 'No confirmed candle pattern' };
  }

  let score = strongest.strength;
  const side = strongest.side;

  if (side === 0) {
    return {
      action: 'NO TRADE',
      score,
      reason: strongest.name + ' is neutral'
    };
  }

  if (marketMap) {
    if (side === 1 && marketMap.trend?.includes('BULLISH')) score += 2;
    if (side === -1 && marketMap.trend?.includes('BEARISH')) score += 2;
    if (side === 1 && marketMap.reversal === 'BULLISH REVERSAL') score += 2;
    if (side === -1 && marketMap.reversal === 'BEARISH REVERSAL') score += 2;
    if (side === 1 && marketMap.breakout === 'BREAKOUT UP') score += 2;
    if (side === -1 && marketMap.breakout === 'BREAKDOWN') score += 2;
  }

  const edgeSide = edge?.latestActionable?.side || 0;
  if (edgeSide === side) score += 2;

  const mtfSide = mtf?.overall?.includes('BUY') ? 1 : mtf?.overall?.includes('SELL') ? -1 : 0;
  if (mtfSide === side) score += 2;

  const action =
    score >= 8
      ? side === 1 ? 'BUY REVERSAL' : 'SELL REVERSAL'
      : 'NO TRADE';

  return {
    action,
    score,
    reason: strongest.name,
    side,
    pattern: strongest.name
  };
}
