// smrt-trade-finalizer.js
// ============================================================
// SMRT TRADE FINALIZER - NIFTY 50 PRIME
//
// Closed-candle deterministic decision support.
// No automatic order placement.
//
// PRIME RULE:
// Mandatory trend/momentum/MTF alignment must pass BEFORE
// weighted confluence can create BUY / SELL.
//
// Missing or conflicting mandatory evidence => NO TRADE.
// ============================================================

const finite = v =>
  v !== null &&
  v !== undefined &&
  v !== '' &&
  Number.isFinite(Number(v));

const sideFromText = value => {
  const text = String(value || '')
    .trim()
    .toUpperCase();

  if (
    text.includes('BUY') ||
    text.includes('BULLISH') ||
    text.startsWith('LONG')
  ) {
    return 1;
  }

  if (
    text.includes('SELL') ||
    text.includes('BEARISH') ||
    text.startsWith('SHORT')
  ) {
    return -1;
  }

  return 0;
};

function currentClosedEdge(edge) {
  const row = edge?.latest;

  if (!row) {
    return null;
  }

  return [
    'BUY+',
    'SELL+',
    'BUY',
    'SELL'
  ].includes(row.signal)
    ? row
    : null;
}

function noTrade({
  reason,
  time = null,
  bullScore = 0,
  bearScore = 0,
  score = 0,
  mandatory = null
}) {
  return {
    state: 'NO TRADE',
    score,
    side: 0,

    bullScore,
    bearScore,

    reasons: [reason],

    invalidation: reason,

    plan: null,

    mandatory,

    time
  };
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

  // ==========================================================
  // CLOSED CANDLE
  // ==========================================================
  //
  // The app currently supplies the live/forming candle as the
  // final array element. Therefore index length - 2 is the
  // latest completed candle.
  // ==========================================================

  if (
    !Array.isArray(data) ||
    data.length < 3 ||
    !calc ||
    !trend
  ) {
    return noTrade({
      reason: 'Waiting for enough closed-candle data'
    });
  }

  const closed =
    data.length - 2;

  const candle =
    data[closed];

  if (!candle) {
    return noTrade({
      reason: 'Closed candle unavailable'
    });
  }

  const time =
    candle.time ?? null;

  // ==========================================================
  // TECHNICAL VALUES
  // ==========================================================

  const close =
    Number(candle.close);

  const e9 =
    calc.e9?.[closed];

  const e21 =
    calc.e21?.[closed];

  const e50 =
    calc.e50?.[closed];

  const rsi =
    calc.rsi?.[closed];

  const hist =
    calc.hist?.[closed];

  const st =
    trend.direction?.[closed];

  const adx =
    trend.adx?.[closed];

  const plusDI =
    trend.plusDI?.[closed];

  const minusDI =
    trend.minusDI?.[closed];

  // Prefer trend engine ATR.
  // Market Map ATR remains fallback.
  const trendATR =
    trend.atr?.[closed];

  const mapATR =
    marketMap?.atr;

  const atr =
    finite(trendATR)
      ? Number(trendATR)
      : finite(mapATR)
        ? Number(mapATR)
        : null;

  const indexVWAP =
    calc.vwap?.[closed];

  // IMPORTANT:
  // Never manufacture NIFTY index VWAP.
  // futuresVWAP is only used if supplied by the app.
  const vwap =
    finite(indexVWAP)
      ? Number(indexVWAP)
      : finite(futuresVWAP)
        ? Number(futuresVWAP)
        : null;

  // ==========================================================
  // READINESS
  // ==========================================================

  const mandatoryValuesReady =
    [
      close,
      e9,
      e21,
      e50,
      rsi,
      hist,
      adx,
      plusDI,
      minusDI
    ].every(finite) &&
    (
      st === 1 ||
      st === -1
    );

  if (!mandatoryValuesReady) {
    return noTrade({
      reason:
        'Prime mandatory indicators are not ready',
      time
    });
  }

  // ==========================================================
  // MTF
  // ==========================================================

  const mtfOverall =
    String(
      mtf?.overall ||
      'NO TRADE'
    ).toUpperCase();

  const mtfSide =
    sideFromText(mtfOverall);

  // MTF is mandatory.
  if (
    mtfSide !== 1 &&
    mtfSide !== -1
  ) {
    return noTrade({
      reason:
        '5m / 15m / 1h confirmation is not ready',
      time
    });
  }

  // ==========================================================
  // PRIME MANDATORY CONDITIONS
  // ==========================================================

  const emaBull =
    Number(e9) >
      Number(e21) &&
    Number(e21) >
      Number(e50);

  const emaBear =
    Number(e9) <
      Number(e21) &&
    Number(e21) <
      Number(e50);

  const supertrendBull =
    Number(st) === 1;

  const supertrendBear =
    Number(st) === -1;

  const dmiBull =
    Number(adx) >= 22 &&
    Number(plusDI) >
      Number(minusDI);

  const dmiBear =
    Number(adx) >= 22 &&
    Number(minusDI) >
      Number(plusDI);

  const rsiBull =
    Number(rsi) >= 52 &&
    Number(rsi) <= 68;

  const rsiBear =
    Number(rsi) >= 32 &&
    Number(rsi) <= 48;

  const macdBull =
    Number(hist) > 0;

  const macdBear =
    Number(hist) < 0;

  const buyEligible =
    emaBull &&
    supertrendBull &&
    dmiBull &&
    rsiBull &&
    macdBull &&
    mtfSide === 1;

  const sellEligible =
    emaBear &&
    supertrendBear &&
    dmiBear &&
    rsiBear &&
    macdBear &&
    mtfSide === -1;

  const mandatory = {
    emaBull,
    emaBear,

    supertrendBull,
    supertrendBear,

    dmiBull,
    dmiBear,

    rsiBull,
    rsiBear,

    macdBull,
    macdBear,

    mtfSide,

    adx: Number(adx),
    plusDI: Number(plusDI),
    minusDI: Number(minusDI),

    rsi: Number(rsi),
    macdHistogram: Number(hist)
  };

  // ==========================================================
  // FAIL CLOSED
  // ==========================================================

  if (
    !buyEligible &&
    !sellEligible
  ) {
    return noTrade({
      reason:
        'Prime mandatory conditions are not aligned',
      time,
      mandatory
    });
  }

  const primeSide =
    buyEligible
      ? 1
      : -1;

  // ==========================================================
  // WEIGHTED CONFLUENCE
  // ==========================================================

  let bull = 0;
  let bear = 0;

  const bullReasons = [];
  const bearReasons = [];
  const riskReasons = [];

  const edgeNow =
    currentClosedEdge(edge);

  // ----------------------------------------------------------
  // NIFTY EDGE
  // ----------------------------------------------------------

  if (
    edgeNow?.side === 1
  ) {
    bull +=
      edgeNow.signal === 'BUY+'
        ? 18
        : 14;

    bullReasons.push(
      'SMRT NIFTY EDGE bullish'
    );
  }

  if (
    edgeNow?.side === -1
  ) {
    bear +=
      edgeNow.signal === 'SELL+'
        ? 18
        : 14;

    bearReasons.push(
      'SMRT NIFTY EDGE bearish'
    );
  }

  // ----------------------------------------------------------
  // MTF
  // ----------------------------------------------------------

  if (mtfSide === 1) {
    bull += 18;

    bullReasons.push(
      '5m / 15m / 1h aligned bullish'
    );
  }

  if (mtfSide === -1) {
    bear += 18;

    bearReasons.push(
      '5m / 15m / 1h aligned bearish'
    );
  }

  // ----------------------------------------------------------
  // EMA
  // ----------------------------------------------------------

  if (emaBull) {
    bull += 10;

    bullReasons.push(
      'EMA 9 > 21 > 50'
    );
  }

  if (emaBear) {
    bear += 10;

    bearReasons.push(
      'EMA 9 < 21 < 50'
    );
  }

  // ----------------------------------------------------------
  // SUPERTREND
  // ----------------------------------------------------------

  if (supertrendBull) {
    bull += 8;

    bullReasons.push(
      'Supertrend bullish'
    );
  }

  if (supertrendBear) {
    bear += 8;

    bearReasons.push(
      'Supertrend bearish'
    );
  }

  // ----------------------------------------------------------
  // ADX / DMI
  // ----------------------------------------------------------

  if (dmiBull) {
    bull += 10;

    bullReasons.push(
      'ADX/DMI bullish trend strength'
    );
  }

  if (dmiBear) {
    bear += 10;

    bearReasons.push(
      'ADX/DMI bearish trend strength'
    );
  }

  // ----------------------------------------------------------
  // RSI
  // ----------------------------------------------------------

  if (rsiBull) {
    bull += 6;

    bullReasons.push(
      'RSI bullish regime'
    );
  }

  if (rsiBear) {
    bear += 6;

    bearReasons.push(
      'RSI bearish regime'
    );
  }

  // ----------------------------------------------------------
  // MACD
  // ----------------------------------------------------------

  if (macdBull) {
    bull += 5;

    bullReasons.push(
      'MACD momentum positive'
    );
  }

  if (macdBear) {
    bear += 5;

    bearReasons.push(
      'MACD momentum negative'
    );
  }

  // ----------------------------------------------------------
  // VWAP
  // ----------------------------------------------------------

  if (finite(vwap)) {
    if (
      close >
      Number(vwap)
    ) {
      bull += 6;

      bullReasons.push(
        'Price above VWAP'
      );

    } else if (
      close <
      Number(vwap)
    ) {
      bear += 6;

      bearReasons.push(
        'Price below VWAP'
      );
    }
  }

  // ----------------------------------------------------------
  // MARKET MAP
  // ----------------------------------------------------------

  if (
    marketMap?.trend
      ?.toUpperCase()
      .includes('BULLISH')
  ) {
    bull += 6;

    bullReasons.push(
      'Market Map bullish'
    );
  }

  if (
    marketMap?.trend
      ?.toUpperCase()
      .includes('BEARISH')
  ) {
    bear += 6;

    bearReasons.push(
      'Market Map bearish'
    );
  }

  if (
    marketMap?.breakout ===
    'BREAKOUT UP'
  ) {
    bull += 6;

    bullReasons.push(
      'Breakout confirmed'
    );
  }

  if (
    marketMap?.breakout ===
    'BREAKDOWN'
  ) {
    bear += 6;

    bearReasons.push(
      'Breakdown confirmed'
    );
  }

  if (
    marketMap?.reversal ===
    'BULLISH REVERSAL'
  ) {
    bull += 5;

    bullReasons.push(
      'Bullish reversal confirmation'
    );
  }

  if (
    marketMap?.reversal ===
    'BEARISH REVERSAL'
  ) {
    bear += 5;

    bearReasons.push(
      'Bearish reversal confirmation'
    );
  }

  // ----------------------------------------------------------
  // CANDLE SCANNER
  // ----------------------------------------------------------

  const candleAction =
    String(
      candleSetup?.action || ''
    ).toUpperCase();

  if (
    candleAction.startsWith('BUY')
  ) {
    bull += 7;

    bullReasons.push(
      'Candlestick confluence bullish'
    );
  }

  if (
    candleAction.startsWith('SELL')
  ) {
    bear += 7;

    bearReasons.push(
      'Candlestick confluence bearish'
    );
  }

  // ==========================================================
  // SUPPORT / RESISTANCE RISK
  // ==========================================================

  const resistance =
    marketMap?.nearestResistance
      ?.price;

  const support =
    marketMap?.nearestSupport
      ?.price;

  let bullPenalty = 0;
  let bearPenalty = 0;

  if (
    finite(atr) &&
    Number(atr) > 0
  ) {
    if (
      finite(resistance) &&
      Number(resistance) > close
    ) {
      const distance =
        Number(resistance) -
        close;

      if (
        distance <
        Number(atr) * 0.55
      ) {
        bullPenalty += 10;

        riskReasons.push(
          'Buy risk: resistance too close'
        );
      }
    }

    if (
      finite(support) &&
      Number(support) < close
    ) {
      const distance =
        close -
        Number(support);

      if (
        distance <
        Number(atr) * 0.55
      ) {
        bearPenalty += 10;

        riskReasons.push(
          'Sell risk: support too close'
        );
      }
    }
  }

  bull =
    Math.max(
      0,
      bull - bullPenalty
    );

  bear =
    Math.max(
      0,
      bear - bearPenalty
    );

  // ==========================================================
  // SCORE
  // ==========================================================

  const winning =
    primeSide === 1
      ? bull
      : bear;

  const losing =
    primeSide === 1
      ? bear
      : bull;

  const separation =
    winning - losing;

  const score =
    Math.max(
      0,
      Math.min(
        100,
        Math.round(
          winning -
          losing * 0.35
        )
      )
    );

  // ==========================================================
  // FINAL STATE
  // ==========================================================

  let state =
    'NO TRADE';

  if (
    primeSide === 1 &&
    score >= 82 &&
    separation >= 28
  ) {
    state =
      'STRONG BUY SETUP';

  } else if (
    primeSide === 1 &&
    score >= 68 &&
    separation >= 20
  ) {
    state =
      'BUY SETUP';

  } else if (
    primeSide === -1 &&
    score >= 82 &&
    separation >= 28
  ) {
    state =
      'STRONG SELL SETUP';

  } else if (
    primeSide === -1 &&
    score >= 68 &&
    separation >= 20
  ) {
    state =
      'SELL SETUP';
  }

  // ==========================================================
  // FINAL SAFETY CHECK
  // ==========================================================

  const stateSide =
    sideFromText(state);

  if (
    stateSide !== 0 &&
    stateSide !== primeSide
  ) {
    state =
      'NO TRADE';
  }

  // ==========================================================
  // TRADE PLAN
  // ==========================================================

  let plan =
    null;

  if (
    state !== 'NO TRADE'
  ) {

    // Prefer NIFTY EDGE plan only when
    // EDGE direction matches final direction.
    if (
      edgeNow?.plan &&
      Number(edgeNow?.side) ===
        primeSide
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

      const entry =
        close;

      let stop;

      if (
        primeSide === 1
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
            primeSide * risk,

          target2:
            entry +
            primeSide *
              risk *
              1.5,

          target3:
            entry +
            primeSide *
              risk *
              2
        };
      }
    }
  }

  // ==========================================================
  // INVALIDATION
  // ==========================================================

  let invalidation;

  if (
    state.includes('BUY')
  ) {
    invalidation =
      finite(support)
        ? 'Invalid below support ₹' +
          Number(support)
            .toFixed(2)
        : 'Invalid if bullish structure fails';

  } else if (
    state.includes('SELL')
  ) {
    invalidation =
      finite(resistance)
        ? 'Invalid above resistance ₹' +
          Number(resistance)
            .toFixed(2)
        : 'Invalid if bearish structure fails';

  } else if (
    separation < 20
  ) {
    invalidation =
      'Confluence separation below trade threshold';

  } else {
    invalidation =
      'Prime confluence below trade threshold';
  }

  // ==========================================================
  // REASONS
  // ==========================================================

  const directionalReasons =
    primeSide === 1
      ? bullReasons
      : bearReasons;

  const reasons = [
    ...directionalReasons,
    ...riskReasons
  ].slice(0, 10);

  if (
    state === 'NO TRADE' &&
    reasons.length === 0
  ) {
    reasons.push(
      'Prime confluence below trade threshold'
    );
  }

  // ==========================================================
  // RESULT
  // ==========================================================

  return {
    state,

    score,

    side:
      state.includes('BUY')
        ? 1
        : state.includes('SELL')
          ? -1
          : 0,

    primeSide,

    bullScore:
      bull,

    bearScore:
      bear,

    separation,

    reasons,

    invalidation,

    plan,

    mandatory,

    time
  };
}
