// smrt-all-indicators.js
// ============================================================
// SMRT ALL INDICATORS CONSENSUS - NIFTY 50 PRIME
//
// FINAL DISPLAY CONSENSUS.
//
// RULES:
// 1. Missing / WAIT / NOT READY never becomes BUY or SELL.
// 2. Minimum 4 active groups.
// 3. Trade Finalizer must be actionable.
// 4. MTF must be directional.
// 5. Finalizer and MTF must agree.
// 6. Consensus cannot override Finalizer direction.
// 7. NO TRADE confidence is capped.
// 8. No automatic order placement.
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

const actionableFinalizerSide = finalizer => {
  const state = String(
    finalizer?.state || ''
  )
    .trim()
    .toUpperCase();

  if (
    state === 'BUY SETUP' ||
    state === 'STRONG BUY SETUP'
  ) {
    return 1;
  }

  if (
    state === 'SELL SETUP' ||
    state === 'STRONG SELL SETUP'
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

  const TOTAL_GROUPS = 7;
  const MIN_ACTIVE_GROUPS = 4;

  // ==========================================================
  // VOTE HELPER
  // ==========================================================

  const pushVote = (
    name,
    side,
    weight,
    detail
  ) => {
    if (
      side !== 1 &&
      side !== -1
    ) {
      return;
    }

    const safeWeight =
      Number(weight);

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
    actionableFinalizerSide(
      finalizer
    );

  pushVote(
    'Trade Finalizer',
    finalizerSide,
    4,
    finalizer?.state
  );

  // ==========================================================
  // 2. NIFTY EDGE
  // ==========================================================

  const edgeLatest =
    edge?.latest;

  const edgeSignal =
    String(
      edgeLatest?.signal || ''
    ).toUpperCase();

  const edgeSide =
    [
      'BUY',
      'BUY+',
      'SELL',
      'SELL+'
    ].includes(edgeSignal)
      ? Number(edgeLatest?.side) ||
        sideFromText(edgeSignal)
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

  const mapAction =
    String(
      marketMap?.action || ''
    )
      .trim()
      .toUpperCase();

  if (
    mapAction &&
    mapAction !== 'NO TRADE' &&
    mapAction !== 'WAIT' &&
    mapAction !== 'NOT READY'
  ) {
    mapSide =
      sideFromText(mapAction);

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

  const mtfSide =
    sideFromText(
      mtf?.overall
    );

  pushVote(
    'MTF 5m/15m/1h',
    mtfSide,
    4,
    mtf?.overall
  );

  // ==========================================================
  // 5. SSL + QQE
  // ==========================================================

  const gainzSignal =
    String(
      gainz?.latest?.signal || ''
    )
      .trim()
      .toUpperCase();

  const gainzSide =
    (
      gainzSignal.startsWith('LONG') ||
      gainzSignal.startsWith('SHORT')
    )
      ? (
          Number(
            gainz?.latest?.side
          ) ||
          sideFromText(
            gainzSignal
          )
        )
      : 0;

  pushVote(
    'SSL + QQE',
    gainzSide,
    3,
    gainz?.latest?.signal
  );

  // ==========================================================
  // 6. AI NIFTY
  // ==========================================================

  const aiSide =
    sideFromText(
      aiNifty?.signal
    );

  pushVote(
    'AI NIFTY',
    aiSide,
    2,
    aiNifty?.signal
  );

  // ==========================================================
  // 7. GLOBAL WATCH
  // ==========================================================

  const globalSide =
    sideFromText(
      globalWatch?.bias
    );

  pushVote(
    'Global Watch',
    globalSide,
    1,
    globalWatch?.bias
  );

  // ==========================================================
  // WEIGHTS
  // ==========================================================

  const bullWeight =
    votes
      .filter(
        vote =>
          vote.side === 1
      )
      .reduce(
        (sum, vote) =>
          sum + vote.weight,
        0
      );

  const bearWeight =
    votes
      .filter(
        vote =>
          vote.side === -1
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
  // PARTICIPATION
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
            vote.side ===
            -leader
        ).length;

  const participation =
    Math.min(
      100,
      (
        activeGroups /
        TOTAL_GROUPS
      ) * 100
    );

  // ==========================================================
  // CONFIDENCE
  // ==========================================================

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
  // PRIME MANDATORY GATE
  // ==========================================================

  let gatePassed = true;
  let gateReason = null;

  if (
    finalizerSide !== 1 &&
    finalizerSide !== -1
  ) {
    gatePassed = false;

    gateReason =
      'Trade Finalizer has not confirmed an actionable setup.';

  } else if (
    mtfSide !== 1 &&
    mtfSide !== -1
  ) {
    gatePassed = false;

    gateReason =
      '5m / 15m / 1h confirmation is not ready.';

  } else if (
    finalizerSide !==
    mtfSide
  ) {
    gatePassed = false;

    gateReason =
      'Trade Finalizer and MTF directions conflict.';
  }

  // ==========================================================
  // SIGNAL
  // ==========================================================

  let signal =
    'NO TRADE';

  if (
    gatePassed &&
    activeGroups >=
      MIN_ACTIVE_GROUPS &&
    leader ===
      finalizerSide &&
    alignment >= 80 &&
    margin >= 6
  ) {
    signal =
      leader === 1
        ? 'STRONG BUY'
        : 'STRONG SELL';

  } else if (
    gatePassed &&
    activeGroups >=
      MIN_ACTIVE_GROUPS &&
    leader ===
      finalizerSide &&
    alignment >= 65 &&
    margin >= 3
  ) {
    signal =
      leader === 1
        ? 'BUY'
        : 'SELL';
  }

  // ==========================================================
  // FINAL DIRECTIONAL SAFETY
  // ==========================================================

  let side =
    signal.includes('BUY')
      ? 1
      : signal.includes('SELL')
        ? -1
        : 0;

  if (
    side !== 0 &&
    (
      side !== finalizerSide ||
      side !== mtfSide
    )
  ) {
    signal =
      'NO TRADE';

    side = 0;

    gatePassed = false;

    gateReason =
      'Final display direction failed Prime confirmation.';
  }

  // ==========================================================
  // SSL + QQE CONFLICT GUARD
  // ==========================================================
  //
  // SSL/QQE is supporting confirmation.
  // An explicit OPPOSITE actionable SSL signal blocks the trade.
  // Missing/NO TRADE SSL does not manufacture confirmation.
  // ==========================================================

  if (
    side !== 0 &&
    gainzSide !== 0 &&
    gainzSide !== side
  ) {
    signal =
      'NO TRADE';

    side = 0;

    gatePassed = false;

    gateReason =
      'SSL + QQE conflicts with the proposed trade direction.';
  }

  // ==========================================================
  // CONFIDENCE SAFETY
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

  // ==========================================================
  // REASON
  // ==========================================================

  let reason;

  if (gateReason) {
    reason =
      gateReason;

  } else if (
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
      'Indicators do not meet the Prime confirmation threshold.';

  } else {
    reason =
      alignedCount +
      ' indicator groups align with the ' +
      (
        side === 1
          ? 'bullish'
          : 'bearish'
      ) +
      ' Prime direction.';
  }

  // ==========================================================
  // RESULT
  // ==========================================================

  return {
    signal,
    side,

    confidence,

    alignment:
      Math.round(
        alignment
      ),

    participation:
      Math.round(
        participation
      ),

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

    // Prime audit fields.
    gatePassed,
    gateReason,

    finalizerSide,
    mtfSide,
    gainzSide,

    reason
  };
}
