// smrt-ai-indicator.js
// ============================================================
// SMRT AI INDICATOR
// Deterministic meta-indicator over confirmed closed-candle
// outputs. It never predicts price and never fabricates missing
// market breadth, options, GIFT NIFTY, volume, or VWAP data.
// ============================================================

const finite = value =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isFinite(Number(value));

const wait = (
  reason,
  {
    time = null,
    score = 0,
    regime = 'UNAVAILABLE',
    reasons = []
  } = {}
) => ({
  signal: 'AI WAIT',
  side: 0,
  score,
  confluenceScore: score,
  regime,
  reasons: [
    reason,
    ...reasons
  ].filter(Boolean).slice(0, 8),
  time,
  marker: false
});

const sideFromText = value => {
  const text = String(value || '')
    .trim()
    .toUpperCase();

  if (/NO TRADE|WAIT|MIXED|UNAVAILABLE|NOT READY|WARM/.test(text)) {
    return 0;
  }

  const up = /\b(BUY|LONG|BULLISH|CALL)\b/.test(text);
  const down = /\b(SELL|SHORT|BEARISH|PUT)\b/.test(text);

  return up === down
    ? 0
    : up
      ? 1
      : -1;
};

const sameTime = (
  source,
  time
) =>
  source?.time === null ||
  source?.time === undefined ||
  time === null ||
  time === undefined ||
  Number(source.time) === Number(time);

function addVote(
  votes,
  blockers,
  {
    name,
    side,
    weight,
    reason,
    mandatory = false,
    requiredTime = null,
    sourceTime = null
  }
) {
  if (
    requiredTime !== null &&
    sourceTime !== null &&
    Number(sourceTime) !== Number(requiredTime)
  ) {
    blockers.push(name + ' stale');
    return;
  }

  if (side !== 1 && side !== -1) {
    if (mandatory) {
      blockers.push(name + ' unavailable or neutral');
    }

    return;
  }

  votes.push({
    name,
    side,
    weight,
    reason
  });
}

export function analyseSmrtAiIndicator({
  candles,
  calc,
  trend,
  mtf,
  marketMap,
  liquidity,
  niftyEdge,
  momentum,
  efficiency,
  finalizer,
  consensus,
  futuresVWAP,
  minClosedCandles = 220
} = {}) {
  if (!Array.isArray(candles) || candles.length < minClosedCandles + 1) {
    return wait(
      'Technical warm-up requires 220 closed candles before AI analysis',
      {
        score: 0,
        regime: 'WARMING UP'
      }
    );
  }

  const closed = candles.length - 2;
  const candle = candles[closed];

  if (!candle) {
    return wait('Latest closed candle unavailable');
  }

  const time = candle.time ?? null;
  const close = Number(candle.close);

  const e9 = calc?.e9?.[closed];
  const e21 = calc?.e21?.[closed];
  const e50 = calc?.e50?.[closed];
  const e200 = calc?.e200?.[closed];
  const rsi = calc?.rsi?.[closed];
  const hist = calc?.hist?.[closed];
  const indexVWAP = calc?.vwap?.[closed];

  const st = trend?.direction?.[closed];
  const adx = trend?.adx?.[closed];
  const plusDI = trend?.plusDI?.[closed];
  const minusDI = trend?.minusDI?.[closed];

  if (
    ![
      close,
      e9,
      e21,
      e50,
      e200,
      rsi,
      hist,
      adx,
      plusDI,
      minusDI
    ].every(finite) ||
    (st !== 1 && st !== -1)
  ) {
    return wait(
      'Mandatory closed-candle indicators unavailable',
      {
        time,
        regime: 'WARMING UP'
      }
    );
  }

  const votes = [];
  const blockers = [];

  const emaSide =
    Number(e9) > Number(e21) &&
    Number(e21) > Number(e50) &&
    Number(e50) > Number(e200)
      ? 1
      : Number(e9) < Number(e21) &&
          Number(e21) < Number(e50) &&
          Number(e50) < Number(e200)
        ? -1
        : 0;

  addVote(votes, blockers, {
    name: 'EMA 9/21/50/200',
    side: emaSide,
    weight: 12,
    reason:
      emaSide === 1
        ? 'EMA stack bullish'
        : 'EMA stack bearish',
    mandatory: true
  });

  addVote(votes, blockers, {
    name: 'Supertrend',
    side: st,
    weight: 10,
    reason:
      st === 1
        ? 'Supertrend bullish'
        : 'Supertrend bearish',
    mandatory: true
  });

  const dmiSide =
    Number(adx) >= 22 &&
    Number(plusDI) > Number(minusDI)
      ? 1
      : Number(adx) >= 22 &&
          Number(minusDI) > Number(plusDI)
        ? -1
        : 0;

  addVote(votes, blockers, {
    name: 'ADX/DMI',
    side: dmiSide,
    weight: 10,
    reason:
      dmiSide === 1
        ? 'ADX/DMI bullish strength'
        : 'ADX/DMI bearish strength',
    mandatory: true
  });

  const rsiSide =
    Number(rsi) >= 54 &&
    Number(rsi) <= 68
      ? 1
      : Number(rsi) >= 32 &&
          Number(rsi) <= 46
        ? -1
        : 0;

  addVote(votes, blockers, {
    name: 'RSI',
    side: rsiSide,
    weight: 6,
    reason:
      rsiSide === 1
        ? 'RSI bullish regime'
        : 'RSI bearish regime',
    mandatory: true
  });

  const macdSide =
    Number(hist) > 0
      ? 1
      : Number(hist) < 0
        ? -1
        : 0;

  addVote(votes, blockers, {
    name: 'MACD',
    side: macdSide,
    weight: 6,
    reason:
      macdSide === 1
        ? 'MACD histogram positive'
        : 'MACD histogram negative',
    mandatory: true
  });

  const vwap =
    finite(indexVWAP)
      ? Number(indexVWAP)
      : finite(futuresVWAP)
        ? Number(futuresVWAP)
        : null;

  const vwapSide =
    finite(vwap) && close > Number(vwap)
      ? 1
      : finite(vwap) && close < Number(vwap)
        ? -1
        : 0;

  addVote(votes, blockers, {
    name: 'VWAP',
    side: vwapSide,
    weight: 6,
    reason:
      vwapSide === 1
        ? 'Price above genuine VWAP'
        : 'Price below genuine VWAP',
    mandatory: true
  });

  const mtfSide = sideFromText(mtf?.overall);

  addVote(votes, blockers, {
    name: '5m/15m/1h MTF',
    side: mtfSide,
    weight: 14,
    reason:
      mtfSide === 1
        ? 'MTF aligned bullish'
        : 'MTF aligned bearish',
    mandatory: true
  });

  const mapSide = sideFromText(
    marketMap?.action ||
    marketMap?.signal ||
    marketMap?.trend
  );

  addVote(votes, blockers, {
    name: 'Market Map',
    side: mapSide,
    weight: 7,
    reason:
      mapSide === 1
        ? 'Market Map bullish'
        : 'Market Map bearish'
  });

  const edgeSide =
    ['BUY+', 'BUY', 'SELL+', 'SELL'].includes(
      String(niftyEdge?.latest?.signal || '').toUpperCase()
    )
      ? Number(niftyEdge?.latest?.side) ||
        sideFromText(niftyEdge?.latest?.signal)
      : 0;

  addVote(votes, blockers, {
    name: 'NIFTY Edge',
    side: edgeSide,
    weight: 9,
    reason:
      edgeSide === 1
        ? 'NIFTY Edge bullish'
        : 'NIFTY Edge bearish',
    requiredTime: time,
    sourceTime: niftyEdge?.latest?.time ?? null
  });

  const finalizerSide = sideFromText(finalizer?.state);

  addVote(votes, blockers, {
    name: 'Trade Finalizer',
    side: finalizerSide,
    weight: 14,
    reason:
      finalizerSide === 1
        ? 'Finalizer confirms CALL side'
        : 'Finalizer confirms PUT side',
    mandatory: true,
    requiredTime: time,
    sourceTime: finalizer?.time ?? null
  });

  const consensusSide = sideFromText(consensus?.signal);

  addVote(votes, blockers, {
    name: 'All Indicators Consensus',
    side: consensusSide,
    weight: 10,
    reason:
      consensusSide === 1
        ? 'Consensus bullish'
        : 'Consensus bearish',
    mandatory: true
  });

  const momentumSide =
    sideFromText(momentum?.latest?.signal) ||
    sideFromText(momentum?.signal) ||
    sideFromText(momentum?.state);

  addVote(votes, blockers, {
    name: 'Momentum',
    side: momentumSide,
    weight: 4,
    reason:
      momentumSide === 1
        ? 'Momentum bullish'
        : 'Momentum bearish'
  });

  const liquiditySide =
    sideFromText(liquidity?.signal) ||
    sideFromText(liquidity?.setup) ||
    sideFromText(liquidity?.bias);

  addVote(votes, blockers, {
    name: 'Liquidity/FVG',
    side: liquiditySide,
    weight: 4,
    reason:
      liquiditySide === 1
        ? 'Liquidity/FVG supports CALL'
        : 'Liquidity/FVG supports PUT'
  });

  const efficiencyReady = efficiency?.ready === true;
  const efficiencyScore = Number(efficiency?.score);
  const efficiencyBlocked =
    efficiencyReady &&
    (
      efficiencyScore < 40 ||
      String(efficiency?.noise || '').toUpperCase() === 'HIGH' ||
      String(efficiency?.regime || '').toUpperCase() === 'CHOPPY'
    );

  if (efficiencyBlocked) {
    blockers.push('Efficiency/market regime too weak');
  }

  const bullWeight = votes
    .filter(vote => vote.side === 1)
    .reduce((sum, vote) => sum + vote.weight, 0);

  const bearWeight = votes
    .filter(vote => vote.side === -1)
    .reduce((sum, vote) => sum + vote.weight, 0);

  const leader =
    bullWeight > bearWeight
      ? 1
      : bearWeight > bullWeight
        ? -1
        : 0;

  const winner = Math.max(bullWeight, bearWeight);
  const loser = Math.min(bullWeight, bearWeight);
  const total = bullWeight + bearWeight;
  const opposingCount =
    leader === 0
      ? 0
      : votes.filter(vote => vote.side === -leader).length;
  const alignedVotes =
    leader === 0
      ? []
      : votes.filter(vote => vote.side === leader);
  const score =
    total > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round((winner / total) * 100)
          )
        )
      : 0;

  const regime =
    efficiencyReady
      ? String(efficiency.regime || 'UNKNOWN').toUpperCase()
      : finalizerSide !== 0 && mtfSide === finalizerSide
        ? 'TRENDING'
        : 'UNCONFIRMED';

  const requiredSides = [
    emaSide,
    st,
    dmiSide,
    rsiSide,
    macdSide,
    vwapSide,
    mtfSide,
    finalizerSide,
    consensusSide
  ];

  const requiredAligned =
    leader !== 0 &&
    requiredSides.every(side => side === leader);

  if (
    blockers.length ||
    leader === 0 ||
    !requiredAligned ||
    score < 86 ||
    winner < 74 ||
    winner - loser < 38 ||
    opposingCount > 0 ||
    finalizer?.primeConfirmed !== true ||
    Number(consensus?.confidence || 0) < 80
  ) {
    return wait(
      blockers[0] ||
        'AI confluence is below conservative confirmation threshold',
      {
        time,
        score,
        regime,
        reasons:
          alignedVotes.length
            ? alignedVotes.map(vote => vote.reason)
            : ['Inputs are mixed or insufficient']
      }
    );
  }

  return {
    signal:
      leader === 1
        ? 'AI CALL'
        : 'AI PUT',
    side: leader,
    score,
    confluenceScore: score,
    regime,
    reasons: alignedVotes
      .map(vote => vote.reason)
      .slice(0, 8),
    time,
    marker: true,
    bullWeight,
    bearWeight,
    winner,
    loser,
    accuracyClaim: false,
    closedCandleOnly: true,
    noLookahead: true,
    sameTime:
      sameTime(finalizer, time) &&
      sameTime(niftyEdge?.latest, time)
  };
}
