// smrt-all-indicators.js
// ============================================================
// SMRT ALL INDICATORS CONSENSUS
// Combines independent indicator groups already calculated by the app.
// Decision-support only. No automatic orders.
// ============================================================

const sideFromText = value => {
  const text =
    String(value || '')
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

  const pushVote =
    (
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

      votes.push({
        name,
        side,
        weight,
        detail
      });
    };

  const finalizerSide =
    Number(
      finalizer?.side
    ) ||
    sideFromText(
      finalizer?.state
    );

  pushVote(
    'Trade Finalizer',
    finalizerSide,
    4,
    finalizer?.state
  );

  const edgeLatest =
    edge?.latest;

  const edgeSide =
    ['BUY','BUY+','SELL','SELL+']
      .includes(
        edgeLatest?.signal
      )
      ? Number(
          edgeLatest?.side
        )
      : 0;

  pushVote(
    'NIFTY EDGE',
    edgeSide,
    3,
    edgeLatest?.signal
  );

  let mapSide = 0;

  if (
    marketMap?.action &&
    marketMap.action !==
      'NO TRADE'
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

  pushVote(
    'MTF 5m/15m/1h',
    sideFromText(
      mtf?.overall
    ),
    4,
    mtf?.overall
  );

  pushVote(
    'SSL + QQE',
    Number(
      gainz?.latest?.side
    ) ||
    sideFromText(
      gainz?.latest?.signal
    ),
    3,
    gainz?.latest?.signal
  );

  pushVote(
    'AI NIFTY',
    sideFromText(
      aiNifty?.signal
    ),
    2,
    aiNifty?.signal
  );

  pushVote(
    'Global Watch',
    sideFromText(
      globalWatch?.bias
    ),
    1,
    globalWatch?.bias
  );

  const bullWeight =
    votes
      .filter(
        vote =>
          vote.side === 1
      )
      .reduce(
        (
          sum,
          vote
        ) =>
          sum +
          vote.weight,
        0
      );

  const bearWeight =
    votes
      .filter(
        vote =>
          vote.side === -1
      )
      .reduce(
        (
          sum,
          vote
        ) =>
          sum +
          vote.weight,
        0
      );

  const totalWeight =
    bullWeight +
    bearWeight;

  const leader =
    bullWeight >
      bearWeight
      ? 1
      : bearWeight >
          bullWeight
        ? -1
        : 0;

  const leaderWeight =
    Math.max(
      bullWeight,
      bearWeight
    );

  const alignment =
    totalWeight > 0
      ? leaderWeight /
        totalWeight *
        100
      : 0;

  const margin =
    Math.abs(
      bullWeight -
      bearWeight
    );

  let signal =
    'NO TRADE';

  if (
    votes.length >= 4 &&
    leader !== 0 &&
    alignment >= 80 &&
    margin >= 6
  ) {
    signal =
      leader === 1
        ? 'STRONG BUY'
        : 'STRONG SELL';
  } else if (
    votes.length >= 4 &&
    leader !== 0 &&
    alignment >= 65 &&
    margin >= 3
  ) {
    signal =
      leader === 1
        ? 'BUY'
        : 'SELL';
  }

  const alignedCount =
    votes.filter(
      vote =>
        vote.side === leader
    ).length;

  const opposingCount =
    votes.filter(
      vote =>
        vote.side ===
          -leader
    ).length;

  return {
    signal,
    side:
      signal.includes('BUY')
        ? 1
        : signal.includes('SELL')
          ? -1
          : 0,
    confidence:
      Math.round(
        alignment
      ),
    bullWeight,
    bearWeight,
    alignedCount,
    opposingCount,
    totalVotes:
      votes.length,
    margin,
    votes,
    reason:
      signal === 'NO TRADE'
        ? 'Indicators are not aligned enough for a confirmed trade.'
        : (
            alignedCount +
            ' indicator groups align with the ' +
            (
              leader === 1
                ? 'bullish'
                : 'bearish'
            ) +
            ' side.'
          )
  };
}
