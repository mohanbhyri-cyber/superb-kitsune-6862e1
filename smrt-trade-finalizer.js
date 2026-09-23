// smrt-trade-finalizer.js
// ============================================================
// SMRT TRADE FINALIZER
// Deterministic decision-support for NIFTY 50.
// Uses latest closed-candle context only. No order placement.
// ============================================================

const finite = v => Number.isFinite(Number(v));

function currentClosedEdge(edge) {
  const row = edge?.latest;
  if (!row) return null;

  return ['BUY+','SELL+','BUY','SELL'].includes(row.signal)
    ? row
    : null;
}

export function finalizeTrade({
  edge,
  marketMap,
  candleSetup,
  mtf,
  calc,
  trend,
  data,
  futuresVWAP
}) {
  const closed = Math.max(0, (data?.length || 0) - 2);
  const candle = data?.[closed];

  if (!candle || !calc || !trend) {
    return {
      state: 'NO TRADE',
      score: 0,
      side: 0,
      reasons: ['Waiting for enough closed-candle data'],
      invalidation: 'Insufficient data',
      plan: null
    };
  }

  const edgeNow = currentClosedEdge(edge);

  const e9 = calc.e9?.[closed];
  const e21 = calc.e21?.[closed];
  const e50 = calc.e50?.[closed];
  const rsi = calc.rsi?.[closed];
  const hist = calc.hist?.[closed];
  const st = trend.direction?.[closed] || 0;
  const adx = trend.adx?.[closed];
  const plusDI = trend.plusDI?.[closed];
  const minusDI = trend.minusDI?.[closed];

  const close = Number(candle.close);
  const indexVWAP = calc.vwap?.[closed];
  const vwap = finite(indexVWAP)
    ? Number(indexVWAP)
    : finite(futuresVWAP)
      ? Number(futuresVWAP)
      : null;

  let bull = 0;
  let bear = 0;
  const reasons = [];

  // Edge signal: strongest weight.
  if (edgeNow?.side === 1) {
    bull += edgeNow.signal === 'BUY+' ? 18 : 14;
    reasons.push('SMRT NIFTY EDGE bullish');
  }
  if (edgeNow?.side === -1) {
    bear += edgeNow.signal === 'SELL+' ? 18 : 14;
    reasons.push('SMRT NIFTY EDGE bearish');
  }

  // Multi-timeframe confirmation.
  const mtfOverall = mtf?.overall || 'NO TRADE';
  if (mtfOverall.includes('BUY')) {
    bull += 18;
    reasons.push('5m / 15m / 1h aligned bullish');
  } else if (mtfOverall.includes('SELL')) {
    bear += 18;
    reasons.push('5m / 15m / 1h aligned bearish');
  }

  // EMA stack.
  if ([e9,e21,e50].every(finite)) {
    if (e9 > e21 && e21 > e50) {
      bull += 10;
      reasons.push('EMA 9 > 21 > 50');
    } else if (e9 < e21 && e21 < e50) {
      bear += 10;
      reasons.push('EMA 9 < 21 < 50');
    }
  }

  // Supertrend.
  if (st === 1) {
    bull += 8;
    reasons.push('Supertrend bullish');
  } else if (st === -1) {
    bear += 8;
    reasons.push('Supertrend bearish');
  }

  // ADX/DMI.
  if ([adx,plusDI,minusDI].every(finite)) {
    if (adx >= 22 && plusDI > minusDI) {
      bull += 10;
      reasons.push('ADX/DMI bullish trend strength');
    } else if (adx >= 22 && minusDI > plusDI) {
      bear += 10;
      reasons.push('ADX/DMI bearish trend strength');
    }
  }

  // RSI regime.
  if (finite(rsi)) {
    if (rsi >= 52 && rsi <= 68) {
      bull += 6;
      reasons.push('RSI bullish zone');
    } else if (rsi <= 48 && rsi >= 32) {
      bear += 6;
      reasons.push('RSI bearish zone');
    }
  }

  // MACD histogram.
  if (finite(hist)) {
    if (hist > 0) {
      bull += 5;
      reasons.push('MACD momentum positive');
    } else if (hist < 0) {
      bear += 5;
      reasons.push('MACD momentum negative');
    }
  }

  // VWAP.
  if (finite(vwap)) {
    if (close > vwap) {
      bull += 6;
      reasons.push('Price above VWAP');
    } else if (close < vwap) {
      bear += 6;
      reasons.push('Price below VWAP');
    }
  }

  // Market Map.
  if (marketMap?.trend?.includes('BULLISH')) {
    bull += 6;
    reasons.push('Market Map bullish');
  }
  if (marketMap?.trend?.includes('BEARISH')) {
    bear += 6;
    reasons.push('Market Map bearish');
  }
  if (marketMap?.breakout === 'BREAKOUT UP') {
    bull += 6;
    reasons.push('Breakout confirmed');
  }
  if (marketMap?.breakout === 'BREAKDOWN') {
    bear += 6;
    reasons.push('Breakdown confirmed');
  }
  if (marketMap?.reversal === 'BULLISH REVERSAL') {
    bull += 5;
    reasons.push('Bullish reversal confirmation');
  }
  if (marketMap?.reversal === 'BEARISH REVERSAL') {
    bear += 5;
    reasons.push('Bearish reversal confirmation');
  }

  // Candle scanner confluence.
  if (candleSetup?.action?.startsWith('BUY')) {
    bull += 7;
    reasons.push('Candlestick confluence bullish');
  }
  if (candleSetup?.action?.startsWith('SELL')) {
    bear += 7;
    reasons.push('Candlestick confluence bearish');
  }

  // Support/resistance proximity risk penalty.
  let bullPenalty = 0;
  let bearPenalty = 0;

  const resistance = marketMap?.nearestResistance?.price;
  const support = marketMap?.nearestSupport?.price;
  const atr = marketMap?.atr;

  if (finite(atr) && atr > 0) {
    if (finite(resistance) && Number(resistance) > close) {
      const distance = Number(resistance) - close;
      if (distance < atr * 0.55) {
        bullPenalty += 10;
        reasons.push('Buy risk: resistance too close');
      }
    }

    if (finite(support) && Number(support) < close) {
      const distance = close - Number(support);
      if (distance < atr * 0.55) {
        bearPenalty += 10;
        reasons.push('Sell risk: support too close');
      }
    }
  }

  bull = Math.max(0, bull - bullPenalty);
  bear = Math.max(0, bear - bearPenalty);

  const side = bull > bear ? 1 : bear > bull ? -1 : 0;
  const winning = Math.max(bull, bear);
  const losing = Math.min(bull, bear);
  const separation = winning - losing;

  // Scale into 0-100, but require separation to avoid mixed signals.
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(winning - losing * 0.35)
    )
  );

  let state = 'NO TRADE';

  if (side === 1 && score >= 82 && separation >= 28) {
    state = 'STRONG BUY SETUP';
  } else if (side === 1 && score >= 68 && separation >= 20) {
    state = 'BUY SETUP';
  } else if (side === -1 && score >= 82 && separation >= 28) {
    state = 'STRONG SELL SETUP';
  } else if (side === -1 && score >= 68 && separation >= 20) {
    state = 'SELL SETUP';
  }

  // Do not finalize against strong higher-timeframe conflict.
  if (
    state.includes('BUY') &&
    mtfOverall.includes('SELL')
  ) {
    state = 'NO TRADE';
  }

  if (
    state.includes('SELL') &&
    mtfOverall.includes('BUY')
  ) {
    state = 'NO TRADE';
  }

  // Build a fresh plan from the SAME closed candle whenever the
  // Finalizer itself confirms a BUY/SELL setup. Prefer the NIFTY EDGE
  // plan when available, but do not leave Entry/SL/TP blank merely
  // because EDGE is still WATCH while Finalizer confluence is valid.
  let plan = null;

  if (
    state !== 'NO TRADE'
  ) {
    if (
      edgeNow?.plan
    ) {
      plan = {
        entry:
          edgeNow.plan.entry,
        stop:
          edgeNow.plan.stop,
        target1:
          edgeNow.plan.target1,
        target2:
          edgeNow.plan.target2,
        target3:
          edgeNow.plan.target3
      };
    } else if (
      finite(atr) &&
      Number(atr) > 0
    ) {
      const planSide =
        state.includes('BUY')
          ? 1
          : -1;

      const entry =
        close;

      let stop;

      if (
        planSide === 1
      ) {
        const atrStop =
          entry -
          Number(atr) * 1.2;

        const supportStop =
          finite(support) &&
          Number(support) < entry
            ? Number(support) -
              Number(atr) * 0.15
            : atrStop;

        stop =
          Math.min(
            atrStop,
            supportStop
          );
      } else {
        const atrStop =
          entry +
          Number(atr) * 1.2;

        const resistanceStop =
          finite(resistance) &&
          Number(resistance) > entry
            ? Number(resistance) +
              Number(atr) * 0.15
            : atrStop;

        stop =
          Math.max(
            atrStop,
            resistanceStop
          );
      }

      const risk =
        Math.abs(
          entry - stop
        );

      if (
        finite(risk) &&
        risk > 0
      ) {
        plan = {
          entry,
          stop,
          target1:
            entry +
            planSide * risk,
          target2:
            entry +
            planSide * risk * 1.5,
          target3:
            entry +
            planSide * risk * 2
        };
      }
    }
  }

  let invalidation = 'None';

  if (state.includes('BUY')) {
    invalidation = finite(support)
      ? 'Invalid below support ₹' + Number(support).toFixed(2)
      : 'Invalid if bullish structure fails';
  } else if (state.includes('SELL')) {
    invalidation = finite(resistance)
      ? 'Invalid above resistance ₹' + Number(resistance).toFixed(2)
      : 'Invalid if bearish structure fails';
  } else {
    invalidation = separation < 20
      ? 'Bullish and bearish evidence are mixed'
      : 'Confluence below trade threshold';
  }

  return {
    state,
    score,
    side: state.includes('BUY') ? 1 : state.includes('SELL') ? -1 : 0,
    bullScore: bull,
    bearScore: bear,
    reasons: reasons.slice(0, 8),
    invalidation,
    plan,
    time: candle.time
  };
}
