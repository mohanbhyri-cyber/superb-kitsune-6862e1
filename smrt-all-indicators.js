// smrt-all-indicators.js
// ============================================================
// SMRT ALL INDICATORS CONSENSUS
// Combines independent indicator groups already calculated by the app.
// Decision-support only. No automatic orders.
//
// FIX:
// - NO TRADE cannot show misleading 100/100 confidence.
// - Confidence includes participation/readiness + directional agreement.
// - Missing groups are NOT treated as zero/bear/bull confirmation.
// - Bull/Bear weight remains visible separately.
// - Minimum 4 active groups required for actionable signal.
// ============================================================

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


export function analyseAllIndicators({
  finalizer,
  edge,
  marketMap,
  mtf,
  gainz,
  aiNifty,
  globalWatch
} = {}) {

  const votes = [];

  // Total independent groups available in this module.
  const TOTAL_GROUPS = 7;
  const MIN_ACTIVE_GROUPS = 4;

  const pushVote = (
    name,
    side,
    weight,
    detail
  ) => {

    // Missing / WAIT / NO TRADE / NOT READY data
    // must NOT become a directional vote.
    if (
      side !== 1 &&
      side !== -1
    ) {
      return;
    }

    const safeWeight = Number(weight);

    if (
      !Number.isFinite(safeWeight) ||
      safeWeight <= 0
    ) {
      return;
    }

    votes.push({
      name,
      side,
      weight: safeWeight,
      detail
    });
  };


  // ==========================================================
  // 1. TRADE FINALIZER
  // ==========================================================

  const finalizerSide =
    Number(finalizer?.side) ||
    sideFromText(finalizer?.state);

  pushVote(
    'Trade Finalizer',
    finalizerSide,
    4,
    finalizer?.state
  );


  // ==========================================================
  // 2. NIFTY EDGE
  // ==========================================================

  const edgeLatest = edge?.latest;

  const edgeSide =
    ['BUY', 'BUY+', 'SELL', 'SELL+']
      .includes(edgeLatest?.signal)
      ? Number(edgeLatest?.side)
      : 0;

  pushVote(
    'NIFTY EDGE',
    edgeSide,
    3,
    edgeLatest?.signal
  );


  // ==========================================================
  // 3. MARKET MAP
  // ==========================================================

  let mapSide = 0;

  if (
    marketMap?.action &&
    marketMap.action !== 'NO TRADE'
  ) {
    mapSide =
      sideFromText(
        marketMap.action
      );
  } else {
    mapSide =
      sideFromText(
        marketMap?.trend
      );
  }

  pushVote(
    'Market Map',
    mapSide,
    2,
    marketMap?.action ||
      marketMap?.trend
  );


  // ==========================================================
  // 4. MULTI TIMEFRAME
  // ==========================================================

  pushVote(
    'MTF 5m/15m/1h',
    sideFromText(
      mtf?.overall
    ),
    4,
    mtf?.overall
  );


  // ==========================================================
  // 5. SSL + QQE
  // ==========================================================

  const gainzSide =
    Number(gainz?.latest?.side) ||
    sideFromText(
      gainz?.latest?.signal
    );

  pushVote(
    'SSL + QQE',
    gainzSide,
    3,
    gainz?.latest?.signal
  );


  // ==========================================================
  // 6. AI NIFTY
  // ==========================================================

  pushVote(
    'AI NIFTY',
    sideFromText(
      aiNifty?.signal
    ),
    2,
    aiNifty?.signal
  );


  // ==========================================================
  // 7. GLOBAL WATCH
  // ==========================================================

  pushVote(
    'Global Watch',
    sideFromText(
      globalWatch?.bias
    ),
    1,
    globalWatch?.bias
  );


  // ==========================================================
  // DIRECTIONAL WEIGHTS
  // ==========================================================

  const bullWeight =
    votes
      .filter(
        vote => vote.side === 1
      )
      .reduce(
        (sum, vote) =>
          sum + vote.weight,
        0
      );


  const bearWeight =
    votes
      .filter(
        vote => vote.side === -1
      )
      .reduce(
        (sum, vote) =>
          sum + vote.weight,
        0
      );


  const totalWeight =
    bullWeight +
    bearWeight;


  const leader =
    bullWeight > bearWeight
      ? 1
      : bearWeight > bullWeight
        ? -1
        : 0;


  const leaderWeight =
    Math.max(
      bullWeight,
      bearWeight
    );


  // Directional agreement among ACTIVE groups.
  const alignment =
    totalWeight > 0
      ? (
          leaderWeight /
          totalWeight
        ) * 100
      : 0;


  const margin =
    Math.abs(
      bullWeight -
      bearWeight
    );


  // ==========================================================
  // ACTIVE GROUP COUNTS
  // ==========================================================

  const activeGroups =
    votes.length;


  const alignedCount =
    leader === 0
      ? 0
      : votes.filter(
          vote =>
            vote.side === leader
        ).length;


  const opposingCount =
    leader === 0
      ? 0
      : votes.filter(
          vote =>
            vote.side === -leader
        ).length;


  // ==========================================================
  // CONFIDENCE FIX
  // ==========================================================
  //
  // OLD:
  // confidence = alignment
  //
  // Problem:
  // 3 bearish groups / 0 bullish groups = 100% alignment.
  // But only 3 of 7 systems are active.
  //
  // NEW:
  // confidence combines:
  //   1. directional agreement
  //   2. system participation/readiness
  //
  // Example:
  // 3 active groups, all bearish:
  // alignment = 100%
  // participation = 3/7 = 42.9%
  // confidence ≈ 43/100
  // ==========================================================

  const participation =
    Math.min(
      100,
      (
        activeGroups /
        TOTAL_GROUPS
      ) * 100
    );


  let confidence =
    totalWeight > 0
      ? Math.round(
          alignment *
          (
            participation /
            100
          )
        )
      : 0;


  confidence =
    Math.max(
      0,
      Math.min(
        100,
        confidence
      )
    );


  // ==========================================================
  // SIGNAL DECISION
  // ==========================================================

  let signal =
    'NO TRADE';


  // Strong signal:
  // minimum participation + broad directional agreement.
  if (
    activeGroups >= MIN_ACTIVE_GROUPS &&
    leader !== 0 &&
    alignment >= 80 &&
    margin >= 6
  ) {

    signal =
      leader === 1
        ? 'STRONG BUY'
        : 'STRONG SELL';

  } else if (
    activeGroups >= MIN_ACTIVE_GROUPS &&
    leader !== 0 &&
    alignment >= 65 &&
    margin >= 3
  ) {

    signal =
      leader === 1
        ? 'BUY'
        : 'SELL';
  }


  // ==========================================================
  // ACTIONABLE CONFIDENCE GUARD
  // ==========================================================
  //
  // NO TRADE should never look like a fully confirmed trade.
  // Directional bias remains available through Bull/Bear weight.
  // ==========================================================

  if (
    signal === 'NO TRADE'
  ) {
    confidence =
      Math.min(
        confidence,
        64
      );
  }


  const side =
    signal.includes('BUY')
      ? 1
      : signal.includes('SELL')
        ? -1
        : 0;


  // ==========================================================
  // REASON TEXT
  // ==========================================================

  let reason;

  if (
    activeGroups === 0
  ) {

    reason =
      'Indicator confirmation is not ready.';

  } else if (
    activeGroups <
    MIN_ACTIVE_GROUPS
  ) {

    reason =
      activeGroups +
      ' of ' +
      TOTAL_GROUPS +
      ' indicator groups are active. Waiting for broader confirmation.';

  } else if (
    signal === 'NO TRADE'
  ) {

    reason =
      'Indicators do not yet meet the confirmation threshold for a trade.';

  } else {

    reason =
      alignedCount +
      ' indicator groups align with the ' +
      (
        leader === 1
          ? 'bullish'
          : 'bearish'
      ) +
      ' side.';
  }


  // ==========================================================
  // RESULT
  // ==========================================================

  return {
    signal,

    side,

    confidence,

    // Keep raw alignment available separately.
    alignment:
      Math.round(alignment),

    participation:
      Math.round(participation),

    bullWeight,

    bearWeight,

    alignedCount,

    opposingCount,

    totalVotes:
      activeGroups,

    totalGroups:
      TOTAL_GROUPS,

    minimumActiveGroups:
      MIN_ACTIVE_GROUPS,

    margin,

    votes,

    reason
  };
}
